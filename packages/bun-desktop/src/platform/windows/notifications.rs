//! https://learn.microsoft.com/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts

use std::cell::RefCell;

use crate::bridge;
use crate::error::Result;
use crate::protocol::{SystemEvent, Text};
use crate::win32::com::{self, Borrowed, Object, Outcome, RuntimeString, class, filled, made};
use crate::win32::*;

thread_local! {
    static SHOWN: RefCell<Vec<(String, IToastNotifier, IToastNotification)>> = RefCell::default();
}

struct Listener(String);

class! { Listener {
    0 [IID_TOAST_ACTIVATED_HANDLER, IID_I_AGILE_OBJECT] { was_activated(toast: Borrowed, details: Borrowed) }
} }

impl Listener {
    /// On any thread.
    fn was_activated(&self, _: Borrowed, details: Borrowed) -> Outcome {
        let details: IToastActivatedEventArgs = details.get()?.cast()?;
        let action = filled(|it| details.get_arguments(it))?
            .text()
            .parse()
            .ok()
            .into();
        bridge::emit_system(SystemEvent::Notification {
            tag: self.0.as_str().into(),
            action,
        });
        Ok(())
    }
}

fn escaped(text: &str) -> String {
    let text = text.replace(|it: char| it.is_control() && it != '\n', " ");
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn show(
    (id, name): &(String, String),
    tag: String,
    title: &str,
    body: &str,
    labels: &[Text],
) -> Result<()> {
    const MOST: usize = 5;
    // What an app without a package or a shortcut is known by.
    registry::set_text(
        Wide::new(format!("Software\\Classes\\AppUserModelId\\{id}")).str(),
        wide!("DisplayName"),
        name,
    )?;
    let actions: String = labels
        .iter()
        .take(MOST)
        .enumerate()
        .map(|(index, it)| {
            format!(
                "<action content=\"{}\" arguments=\"{index}\"/>",
                escaped(it)
            )
        })
        .collect();
    let texts = format!(
        "<text>{}</text><text>{}</text>",
        escaped(title),
        escaped(body)
    );
    let xml = RuntimeString::new(&format!(
        "<toast><visual><binding template=\"ToastGeneric\">{texts}</binding></visual><actions>{actions}</actions></toast>"
    ));
    let document = com::activate("Windows.Data.Xml.Dom.XmlDocument")?;
    document.cast::<IXmlDocumentIO>()?.load_xml(xml.0).ok()?;
    let (document, id) = (document.cast::<IXmlDocument>()?, RuntimeString::new(id));
    let toasts: IToastNotificationFactory =
        com::factory("Windows.UI.Notifications.ToastNotification")?;
    let manager: IToastNotificationManagerStatics =
        com::factory("Windows.UI.Notifications.ToastNotificationManager")?;
    let (toast, notifier) = (
        made(|it| toasts.create_toast_notification(document.borrowed(), it))?,
        made(|it| manager.create_toast_notifier_with_id(id.0, it))?,
    );
    toast
        .add_activated(Object::create(Listener(tag.clone())).borrowed(), &mut 0)
        .ok()?;
    notifier.show(toast.borrowed()).ok()?;
    SHOWN.with_borrow_mut(|it| it.push((tag, notifier, toast)));
    Ok(())
}

pub fn dismiss(is_meant: impl Fn(&str) -> bool) {
    SHOWN.with_borrow_mut(|all| {
        all.extract_if(.., |it| is_meant(&it.0))
            .for_each(|(_, notifier, toast)| _ = notifier.hide(toast.borrowed()))
    });
}
