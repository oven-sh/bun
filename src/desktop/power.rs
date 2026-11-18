//! `powerMonitor` and `powerSaveBlocker`

use bun_ui::protocol::{NotificationCenter as Center, ThermalState};

use crate::generated_bindgen::system::{
    DesktopPowerMonitor, DesktopPowerSaveBlocker, js_DesktopPowerMonitor,
};
use crate::prelude::*;
use crate::{paths, preferences};

const SESSION_EVENTS: [(&str, Center, &str); 5] = [
    (
        "lock-screen",
        Center::Distributed,
        "com.apple.screenIsLocked",
    ),
    (
        "unlock-screen",
        Center::Distributed,
        "com.apple.screenIsUnlocked",
    ),
    (
        "user-did-become-active",
        Center::Workspace,
        "NSWorkspaceSessionDidBecomeActiveNotification",
    ),
    (
        "user-did-resign-active",
        Center::Workspace,
        "NSWorkspaceSessionDidResignActiveNotification",
    ),
    (
        "shutdown",
        Center::Workspace,
        "NSWorkspaceWillPowerOffNotification",
    ),
];

#[derive(Default)]
struct State {
    blockers: RefCell<Vec<u32>>,
    next_blocker: Cell<u32>,
    was_on_battery: Cell<Option<bool>>,
    is_locked: Cell<bool>,
}

state!(fn state() -> State);

pub(crate) fn monitor() -> JSValue {
    js_DesktopPowerMonitor::CLASS.constructor(heap())
}

notices_listeners!(DesktopPowerMonitor, monitor(), will_listen);

fn will_listen(event: &str) -> JsResult<()> {
    ui()?;
    if let ("on-ac" | "on-battery", None) = (event, state().was_on_battery.get()) {
        return watch_power_source();
    }
    match SESSION_EVENTS.iter().find(|it| it.0 == event) {
        Some(&(_, center, name)) if IS_MAC => preferences::observe(center, name),
        _ => Ok(()),
    }
}

fn watch_power_source() -> JsResult<()> {
    if !IS_WINDOWS {
        later::after(10_000., |_| watch_power_source()).detach();
    }
    let is_on_battery = answer((ui()?.is_on_battery)())?;
    match state().was_on_battery.replace(Some(is_on_battery)) {
        Some(before) if before != is_on_battery => emit(
            monitor(),
            if is_on_battery { "on-battery" } else { "on-ac" },
            &[],
        ),
        _ => Ok(()),
    }
}

pub(crate) fn observed(notification: &str) -> JsResult<()> {
    if IS_WINDOWS && notification == "power source" {
        return watch_power_source();
    }
    let Some(&(event, ..)) = SESSION_EVENTS.iter().find(|it| it.2 == notification) else {
        return Ok(());
    };
    if let "lock-screen" | "unlock-screen" = event {
        state().is_locked.set(event == "lock-screen");
    }
    announce(monitor(), event, &[])
}

fn name_of(state: ThermalState) -> &'static str {
    ["nominal", "fair", "serious", "critical"][state as usize]
}

pub(crate) fn thermal_state_changed(now: ThermalState) -> JsResult<()> {
    emit(
        monitor(),
        "thermal-state-change",
        &[Event::create().with("state", name_of(now))?.to_js()],
    )
}

impl DesktopPowerMonitor {
    pub(crate) fn get_system_idle_time(_: Cx<'_, '_>) -> JsResult<f64> {
        answer((ui()?.idle_seconds)()).map(f64::floor)
    }

    pub(crate) fn get_system_idle_state(cx: Cx<'_, '_>, threshold: f64) -> JsResult<&'static str> {
        Ok(match catch(Self::get_system_idle_time(cx))? {
            _ if state().is_locked.get() => "locked",
            Ok(time) if time >= threshold => "idle",
            Ok(_) => "active",
            Err(_) => "unknown",
        })
    }

    pub(crate) fn get_current_thermal_state(_: Cx<'_, '_>) -> JsResult<JSValue> {
        js(name_of(answer((ui()?.system_state)())?.thermal_state))
    }

    pub(crate) fn get_on_battery_power(_: Cx<'_, '_>) -> JsResult<bool> {
        answer((ui()?.is_on_battery)())
    }
}

impl DesktopPowerSaveBlocker {
    pub(crate) fn start(_: Cx<'_, '_>, kind: &[u8]) -> JsResult<u32> {
        if !matches!(kind, b"prevent-app-suspension" | b"prevent-display-sleep") {
            let reason = "must be \"prevent-app-suspension\" or \"prevent-display-sleep\"";
            return Err(unknown_value("type", &string(kind), reason));
        }
        let id = state().next_blocker.replace(state().next_blocker.get() + 1);
        state().blockers.borrow_mut().push(id);
        tell_system(SystemCommand::PreventSleep {
            id,
            reason: format!("{} is working", paths::app_name()?).into(),
        })?;
        Ok(id)
    }

    pub(crate) fn stop(_: Cx<'_, '_>, id: f64) -> JsResult<bool> {
        if !Self::is_started(id) {
            return Ok(false);
        }
        state()
            .blockers
            .borrow_mut()
            .retain(|it| f64::from(*it) != id);
        tell_system(SystemCommand::AllowSleep(id as u32)).map(|()| true)
    }

    pub(crate) fn is_started(id: f64) -> bool {
        state()
            .blockers
            .borrow()
            .iter()
            .any(|it| f64::from(*it) == id)
    }
}
