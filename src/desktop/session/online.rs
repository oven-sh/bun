//! Whether there is a network, and whether it is still the same.

use bun_web::net::NetError;

use crate::prelude::*;
use crate::realm::{self, Module};
use crate::text::contains;
use crate::webview::wire;
use crate::{app, power, task};

state!(fn addresses() -> RefCell<Option<Vec<String>>>);

fn read_addresses() -> JsResult<Vec<String>> {
    const OF_GUESTS: [&str; 8] = [
        "bridge", "vmenet", "vmnet", "vboxnet", "virbr", "veth", "docker", "br-",
    ];
    let interfaces = wire::data_from_js(invoke(
        realm::require(global(), Module::Os)?,
        "networkInterfaces",
        &[],
    )?)?;
    let starts_with_any = |text: &str, prefixes: &[&str]| {
        prefixes
            .iter()
            .any(|it| text.to_ascii_lowercase().starts_with(it))
    };
    Ok((interfaces.members().iter())
        .filter(|it| !starts_with_any(it.0.text(), &OF_GUESTS))
        .flat_map(|it| it.1.items())
        .filter(|it| {
            !it["internal"].is_truthy()
                && !starts_with_any(it["address"].text(), &["fe80:", "169.254."])
        })
        .map(|it| it["address"].display())
        .collect())
}

fn check() -> JsResult<()> {
    let now = read_addresses()?;
    let before = addresses().replace(Some(now.clone())).unwrap_or_default();
    if before == now {
        return Ok(());
    }
    // Temporary IPv6 addresses come and go all the time.
    let is_cut = now.is_empty()
        || before
            .iter()
            .any(|it| !contains(it, ":") && !now.contains(it));
    for session in super::all() {
        match is_cut {
            true => session.network.disconnect(NetError::NetworkChanged, false),
            false => session.network.close_idle_connections(),
        }
    }
    if before.is_empty() != now.is_empty() {
        crate::contents::online_changed(!now.is_empty());
    }
    Ok(())
}

fn watch_for_resumption() -> JsResult<()> {
    let resumed = procedure(|_| {
        super::all()
            .into_iter()
            .for_each(|it| it.network.disconnect(NetError::NetworkIoSuspended, false));
        check()
    })?;
    invoke(
        power::monitor(),
        "prependListener",
        &[js("resume")?, resumed],
    )
    .map(drop)
}

pub(crate) fn is_online() -> JsResult<bool> {
    if addresses().borrow().is_none() {
        addresses().replace(Some(read_addresses()?));
        task::spawn(async {
            loop {
                task::sleep(3000).await;
                task::report(check());
            }
        });
        match app::is_ready() {
            true => watch_for_resumption()?,
            false => drop(invoke(
                app::object(),
                "once",
                &[
                    js("will-finish-launching")?,
                    procedure(|_| watch_for_resumption())?,
                ],
            )?),
        }
    }
    Ok(addresses()
        .borrow()
        .as_ref()
        .is_some_and(|it| !it.is_empty()))
}
