//! The device that all windows share. Its driver takes time to load and keeps memory, so windows start without it.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::error::{Result, ensure};
use crate::host::thread;
use crate::win32::com::{Borrowed, Interface as _, Outcome, filled, made};
use crate::win32::*;
use crate::window;

pub struct Device {
    direct3d: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub composition: IDCompositionDesktopDevice,
    has_failed: Cell<bool>,
}

struct Started(Device);

// SAFETY: one thread uses it at a time.
unsafe impl Send for Started {}

thread_local! {
    static DEVICE: RefCell<Option<Rc<Device>>> = RefCell::default();
    pub static IS_AVOIDED: Cell<bool> = const { Cell::new(false) };
    static ATTEMPTS: Cell<(u32, Option<Instant>)> = const { Cell::new((0, None)) };
}

static CHOICE: LazyLock<Option<String>> =
    LazyLock::new(|| std::env::var("BUN_DESKTOP_RENDERER").ok());

fn create() -> Result<Device> {
    const HARDWARE: i32 = 1;
    const WITHOUT_THREADS: u32 = 0x8;
    const BGRA: u32 = 0x20;
    const VERSION: u32 = 7;
    const BASIC_RENDER_DRIVER: (u32, u32) = (0x1414, 0x8c);
    let (mut context, none) = (None, Borrowed::default);
    let direct3d = made(|it| {
        D3D11CreateDevice(
            none(),
            HARDWARE,
            0,
            BGRA | WITHOUT_THREADS,
            0,
            0,
            VERSION,
            it,
            &mut 0,
            &mut context,
        )
    })?;
    let graphics: IDXGIDevice3 = direct3d.cast()?;
    let adapter = made(|it| graphics.get_adapter(it))?;
    let adapter = filled(|it| adapter.get_desc(it))?;
    crate::diagnostics::log!("the GPU is {}", string_in(&adapter.description));
    ensure!(
        (adapter.vendor_id, adapter.device_id) != BASIC_RENDER_DRIVER
            || CHOICE.as_deref() == Some("gpu"),
        "it is the CPU"
    );
    let composition = made(|it| {
        create_composition_device(graphics.borrowed(), &IDCompositionDesktopDevice::ID, it)
    })?
    .cast()?;
    Ok(Device {
        direct3d,
        context: context.ok_or(com::Status::FAILED)?,
        composition,
        has_failed: false.into(),
    })
}

/// It can fail for what another process has done, or because the driver was replaced.
pub fn get_ready() {
    const MAX_ATTEMPTS: u32 = 4;
    const PAUSE: Duration = Duration::from_secs(10);
    let (count, last) = ATTEMPTS.get();
    if count == MAX_ATTEMPTS
        || device().is_some()
        || last.is_some_and(|it| it.elapsed() < PAUSE)
        || IS_AVOIDED.get()
        || CHOICE.as_deref() == Some("software")
    {
        return;
    }
    ATTEMPTS.set((count + 1, Some(Instant::now())));
    let start = || {
        let time = Instant::now();
        match create().map(Started) {
            Ok(started) => thread::post(move || {
                crate::diagnostics::log!("the GPU is ready after {:?}", time.elapsed());
                DEVICE.set(Some(Rc::new({ started }.0)));
                window::ids().into_iter().for_each(window::refresh);
            }),
            Err(error) => crate::diagnostics::log!("the GPU is not used: {error:#}"),
        }
    };
    drop(std::thread::Builder::new().name("GPU".into()).spawn(start));
}

pub fn device() -> Option<Rc<Device>> {
    DEVICE.with_borrow(Clone::clone)
}

impl Device {
    pub fn has_failed(&self) -> bool {
        self.has_failed.get()
    }

    /// If it is a failure, the windows go on without this device.
    pub fn check<T>(&self, result: Outcome<T>) -> Option<T> {
        let result =
            result.and_then(|it| self.direct3d.get_device_removed_reason().ok().map(|()| it));
        if let Err(status) = &result
            && !self.has_failed.replace(true)
        {
            crate::diagnostics::log!("the GPU is no longer used: {status:?}");
            DEVICE.take();
            window::ids().into_iter().for_each(window::refresh);
        }
        result.ok()
    }

    /// The driver keeps what it has needed.
    pub fn rest(&self) {
        self.direct3d
            .cast::<IDXGIDevice3>()
            .iter()
            .for_each(IDXGIDevice3::trim);
    }
}
