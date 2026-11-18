//! The service workers of trusted origins.

use bun_web::host::Level;
use bun_web::origin::Origin;
use bun_web::service::{self, News, Notification, RunningStatus};
use bun_web::url::Url;

use super::Session;
use crate::generated_bindgen::system::js_DesktopNotification;
use crate::prelude::*;
use crate::value::Value;
use crate::{process, realm};

/// The web engine counts from 0.
const FIRST_VERSION: f64 = 4_294_967_296.;

#[derive(Default)]
pub(super) struct Own {
    pub(super) running: RefCell<Vec<Value>>,
    notifications: RefCell<Vec<(service::Id, bun_jsc::Strong)>>,
}

impl Session {
    fn tell_about_workers(&self, name: &str, details: &Value) -> JsResult<()> {
        announce(get(self.to_js(), "serviceWorkers")?, name, &[js(details)?])
    }

    pub(super) fn service_workers_report(&'static self, news: News) -> JsResult<()> {
        let version = |id| FIRST_VERSION + f64::from(id);
        match news {
            News::Registered(scope) => self.tell_about_workers(
                "registration-completed",
                &record! { "scope": string(scope.href()) },
            ),
            News::Status {
                worker,
                scope,
                status,
            } => {
                let id = version(worker.id);
                let mut running = self.own_workers.running.borrow_mut();
                running.retain(|it| it["versionId"].number() != id);
                if status == RunningStatus::Running {
                    running.push(record! {
                        "scriptUrl": string(worker.url.href()),
                        "scope": string(scope.href()),
                        "renderProcessId": process::id(),
                        "versionId": id,
                    });
                }
                drop(running);
                let details =
                    object!({ "versionId": id, "runningStatus": string(status.as_bytes()) });
                let workers = get(self.to_js(), "serviceWorkers")?;
                emit(workers, "running-status-changed", &[details]).map(drop)
            }
            News::Console {
                worker,
                level,
                message,
                line,
                url,
            } => self.tell_about_workers(
                "console-message",
                &record! {
                    "message": message,
                    "versionId": version(worker),
                    "source": if level == Level::Error { "javascript" } else { "console-api" },
                    "level": level as i32,
                    "sourceUrl": url,
                    "lineNumber": line,
                },
            ),
            News::ShowNotification(it) => self.show_notification(*it),
            News::CloseNotification(id) => self
                .forget_notification(id)
                .map_or(Ok(()), |it| invoke(it.get(), "close", &[]).map(drop)),
        }
    }

    fn forget_notification(&self, id: service::Id) -> Option<bun_jsc::Strong> {
        let mut all = self.own_workers.notifications.borrow_mut();
        let at = all.iter().position(|it| it.0 == id)?;
        Some(all.swap_remove(at).1)
    }

    fn show_notification(&'static self, it: Notification) -> JsResult<()> {
        let options =
            object!({ "title": it.title, "body": it.body, "silent": it.is_silent == Some(true) });
        let class = js_DesktopNotification::CLASS.constructor(heap());
        let (shown, id) = (realm::instantiate(class, &[options])?, it.id);
        let clicked = listener(self, move |this, _| {
            service::notification_was_clicked(&this.network, id);
            Ok(())
        })?;
        let closed = listener(self, move |this, _| {
            this.forget_notification(id);
            service::notification_was_closed(&this.network, id);
            Ok(())
        })?;
        invoke(shown, "on", &[js("click")?, clicked])?;
        invoke(shown, "on", &[js("close")?, closed])?;
        let kept = bun_jsc::Strong::create(shown, global());
        self.own_workers.notifications.borrow_mut().push((id, kept));
        invoke(shown, "show", &[]).map(drop)
    }

    pub(super) fn lets_notify(&self, url: &Url) -> JsResult<bool> {
        let Some(handler) = self.handler("setPermissionCheckHandler")? else {
            return Ok(true);
        };
        let origin = string(Origin::of(url).as_bytes()) + "/";
        let details = object!({ "isMainFrame": false, "embeddingOrigin": &*origin });
        let arguments = [JSValue::NULL, js("notifications")?, js(origin)?, details];
        Ok(call(handler, &arguments)?.to_boolean())
    }
}
