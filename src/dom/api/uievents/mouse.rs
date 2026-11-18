use core::f64::consts::{FRAC_PI_2, PI, TAU};

use super::*;
use crate::api::transfer::DataTransfer;
use crate::generated_bindgen::uievents::{
    DragEventInit, MouseEventInit, PointerEventInit, WheelEventInit, js_DragEvent, js_MouseEvent,
    js_PointerEvent, js_WheelEvent,
};
use crate::types::Overflow;

#[derive(Clone, Copy, Default)]
pub(crate) struct Mouse {
    pub(crate) screen: [f64; 2],
    pub(crate) client: [f64; 2],
    pub(crate) movement: [f64; 2],
    pub(crate) button: i16,
    pub(crate) buttons: u16,
    pub(crate) modifiers: Modifiers,
}

impl Mouse {
    pub(crate) fn floored(self) -> Mouse {
        Mouse {
            screen: self.screen.map(f64::floor),
            client: self.client.map(f64::floor),
            ..self
        }
    }
}

#[repr(C)]
pub(crate) struct MouseEvent {
    pub(crate) base: UIEvent,
    mouse: Cell<Mouse>,
}

macro_rules! mouse_base {
    ($name:expr, $it:expr) => {
        MouseEvent::base(
            ui_base!($name, $it),
            Mouse {
                screen: [$it.screen_x, $it.screen_y],
                client: [$it.client_x, $it.client_y],
                movement: [$it.movement_x, $it.movement_y],
                button: $it.button,
                buttons: $it.buttons,
                modifiers: modifiers!($it),
            },
        )
    };
}

macro_rules! set_mouse_fields {
    ($heap:expr, $this:expr, $init:expr) => {
        $this.set_view(window($heap, $init.view)?);
        $this.set_related_target(event_target($heap, $init.related_target)?);
    };
}

modifier_getters!(MouseEvent);

impl MouseEvent {
    fn base(base: UIEvent, mouse: Mouse) -> MouseEvent {
        base.base.set(EventFlags::IS_MOUSE_EVENT);
        base.which.set((i32::from(mouse.button) + 1) as u32);
        MouseEvent {
            base,
            mouse: mouse.into(),
        }
    }

    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        detail: i32,
        mouse: Mouse,
    ) -> &'a MouseEvent {
        let this = js_MouseEvent::create(
            doc.heap(heap),
            MouseEvent::base(UIEvent::base(name, init, Trusted::Yes, detail, 0), mouse),
        );
        this.set_view(host::window(doc));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &MouseEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(heap, mouse_base!(name, init));
        set_mouse_fields!(heap, this, init);
        Ok(this)
    }

    pub(crate) fn mouse(&self) -> Mouse {
        self.mouse.get()
    }

    pub(crate) fn modifiers(&self) -> Modifiers {
        self.mouse().modifiers
    }

    pub(crate) fn get_modifier_state(&self, key: &DomString) -> bool {
        self.modifiers().has_named(key)
    }

    pub(crate) fn get_screen_x(&self) -> f64 {
        self.mouse().screen[0]
    }

    pub(crate) fn get_screen_y(&self) -> f64 {
        self.mouse().screen[1]
    }

    pub(crate) fn get_client_x(&self) -> f64 {
        self.mouse().client[0]
    }

    pub(crate) fn get_client_y(&self) -> f64 {
        self.mouse().client[1]
    }

    pub(crate) fn get_movement_x(&self) -> f64 {
        self.mouse().movement[0]
    }

    pub(crate) fn get_movement_y(&self) -> f64 {
        self.mouse().movement[1]
    }

    pub(crate) fn get_button(&self) -> i16 {
        self.mouse().button
    }

    pub(crate) fn get_buttons(&self) -> u16 {
        self.mouse().buttons
    }

    fn shown_target(&self) -> Option<&Node> {
        self.target_node()
            .filter(|it| it.is_connected() && Ui::of(it.doc()).is_some())
    }

    fn page(&self, heap: &JsHeap<'_>, axis: usize) -> f64 {
        let doc = self
            .shown_target()
            .map(Node::doc)
            .or_else(|| host::current_document(heap));
        self.mouse().client[axis] + doc.map_or(0.0, |it| layout::viewport_scroll(it)[axis])
    }

    pub(crate) fn get_page_x(&self, heap: &JsHeap<'_>) -> f64 {
        self.page(heap, 0)
    }

    pub(crate) fn get_page_y(&self, heap: &JsHeap<'_>) -> f64 {
        self.page(heap, 1)
    }

    pub(crate) fn offset<'a>(&'a self, cx: &mut Cx<'a>) -> [f64; 2] {
        match self.shown_target() {
            Some(target) => layout::offset_in(cx, target, self.mouse().client),
            None => [0, 1].map(|it| self.page(&cx.heap, it)),
        }
    }

    pub(crate) fn get_offset_x<'a>(&'a self, cx: &mut Cx<'a>) -> f64 {
        self.offset(cx)[0]
    }

    pub(crate) fn get_offset_y<'a>(&'a self, cx: &mut Cx<'a>) -> f64 {
        self.offset(cx)[1]
    }

    /// From the nearest box that is positioned, transformed or scrolls.
    fn layer<'a>(&'a self, cx: &mut Cx<'a>, axis: usize) -> f64 {
        let mut above = self
            .shown_target()
            .into_iter()
            .flat_map(Node::flat_ancestors)
            .map_while(Node::as_element);
        match above.find(|it| {
            layout::style(cx, it, |it| {
                it.is_positioned()
                    || it.has_transform()
                    || it.layout.overflow_x != Overflow::Visible
                    || it.layout.overflow_y != Overflow::Visible
            }) == Some(true)
        }) {
            Some(layer) => (self.mouse().client[axis]
                - f64::from(layout::bounding_rect(cx, layer).to_array()[axis]))
            .round(),
            None => self.page(&cx.heap, axis),
        }
    }

    pub(crate) fn get_layer_x<'a>(&'a self, cx: &mut Cx<'a>) -> f64 {
        self.layer(cx, 0)
    }

    pub(crate) fn get_layer_y<'a>(&'a self, cx: &mut Cx<'a>) -> f64 {
        self.layer(cx, 1)
    }

    fn end(&self, is_from: bool) -> JSValue {
        if self.downcast::<PointerEvent>().is_some() && self.name().as_str().starts_with("pointer")
        {
            return JSValue::NULL;
        }
        let leaves = matches!(self.name(), atom!("mouseout") | atom!("mouseleave"));
        if leaves == is_from {
            self.target()
        } else {
            self.related_target()
        }
        .unwrap_or(JSValue::NULL)
    }

    pub(crate) fn get_from_element(&self) -> JSValue {
        self.end(true)
    }

    pub(crate) fn get_to_element(&self) -> JSValue {
        self.end(false)
    }

    pub(crate) fn init_mouse_event<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        view: Object<'a>,
        detail: i32,
        screen_x: i32,
        screen_y: i32,
        client_x: i32,
        client_y: i32,
        ctrl: bool,
        alt: bool,
        shift: bool,
        meta: bool,
        button: i16,
        related: Object<'a>,
    ) -> bindgen::Result<'a, ()> {
        let related = event_target(heap, related)?;
        if self
            .base
            .init(heap, name, bubbles, cancelable, view, detail)?
        {
            let (screen, client) = (
                [screen_x, screen_y].map(f64::from),
                [client_x, client_y].map(f64::from),
            );
            self.mouse.set(Mouse {
                screen,
                client,
                button,
                modifiers: Modifiers::from_bools(&[shift, ctrl, alt, meta]),
                ..self.mouse()
            });
            self.which.set((i32::from(button) + 1) as u32);
            self.set_related_target(related);
        }
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct PointerData {
    pub(crate) id: i32,
    pub(crate) kind: Atom,
    pub(crate) is_primary: bool,
    pub(crate) size: [f64; 2],
    pub(crate) pressure: f32,
    pub(crate) tangential_pressure: f32,
    pub(crate) tilt: [i32; 2],
    pub(crate) twist: i32,
    /// The altitude and the azimuth.
    pub(crate) angles: [f64; 2],
    pub(crate) persistent_device_id: i32,
}

impl Default for PointerData {
    fn default() -> Self {
        PointerData {
            id: 0,
            kind: Atom::EMPTY,
            is_primary: false,
            size: [1.0; 2],
            pressure: 0.0,
            tangential_pressure: 0.0,
            tilt: [0; 2],
            twist: 0,
            angles: [FRAC_PI_2, 0.0],
            persistent_device_id: 0,
        }
    }
}

impl PointerData {
    /// https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle
    pub(crate) fn with_orientation(
        mut self,
        tilt: [Option<i32>; 2],
        angles: [Option<f64>; 2],
    ) -> PointerData {
        self.tilt = tilt.map(Option::unwrap_or_default);
        self.angles = [angles[0].unwrap_or(FRAC_PI_2), angles[1].unwrap_or(0.0)];
        if angles == [None; 2] {
            self.angles = angles_of(self.tilt);
        } else if tilt == [None; 2] {
            self.tilt = tilt_of(self.angles);
        }
        self
    }
}

fn angles_of(tilt: [i32; 2]) -> [f64; 2] {
    let [x, y] = tilt.map(|it| f64::from(it).to_radians());
    let is_flat = tilt.iter().any(|it| it.abs() == 90);
    let azimuth = match tilt {
        [(0..), 0] => 0.0,
        [_, 0] => PI,
        [0, (1..)] => FRAC_PI_2,
        [0, _] => 3.0 * FRAC_PI_2,
        _ if is_flat => 0.0,
        _ => y.tan().atan2(x.tan()).rem_euclid(TAU),
    };
    let altitude = match tilt {
        _ if is_flat => 0.0,
        [0, _] | [_, 0] => FRAC_PI_2 - (x + y).abs(),
        _ => (1.0 / x.tan().hypot(y.tan())).atan(),
    };
    [altitude, azimuth]
}

fn tilt_of([altitude, azimuth]: [f64; 2]) -> [i32; 2] {
    [azimuth.cos(), azimuth.sin()].map(|side| match altitude {
        0.0 if side.abs() < 1e-9 || !(0.0..=TAU).contains(&azimuth) => 0,
        0.0 => 90 * side.signum() as i32,
        _ => ((side / altitude.tan()).atan().to_degrees() + 0.5).floor() as i32,
    })
}

#[repr(C)]
pub(crate) struct PointerEvent {
    pub(crate) base: MouseEvent,
    pub(crate) fields: js_PointerEvent::Fields,
    pointer: PointerData,
}

slots!(PointerEvent = js_PointerEvent {} [coalesced: PointerEvent, predicted: PointerEvent,]);

impl PointerEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        trusted: Trusted,
        detail: i32,
        mouse: Mouse,
        pointer: PointerData,
    ) -> &'a PointerEvent {
        let base = MouseEvent::base(UIEvent::base(name, init, trusted, detail, 0), mouse);
        let this = js_PointerEvent::create(
            doc.heap(heap),
            PointerEvent {
                base,
                fields: Default::default(),
                pointer,
            },
        );
        this.set_view(host::window(doc));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &PointerEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let pointer = PointerData {
            id: init.pointer_id,
            kind: init.pointer_type.clone(),
            is_primary: init.is_primary,
            size: [init.width, init.height],
            pressure: init.pressure,
            tangential_pressure: init.tangential_pressure,
            twist: init.twist,
            persistent_device_id: init.persistent_device_id,
            ..Default::default()
        };
        let pointer = pointer.with_orientation(
            [init.tilt_x, init.tilt_y],
            [init.altitude_angle, init.azimuth_angle],
        );
        let this = structure.create(
            heap,
            PointerEvent {
                base: mouse_base!(name, init),
                fields: Default::default(),
                pointer,
            },
        );
        set_mouse_fields!(heap, this, init);
        this.set_coalesced(Refs::collect(
            heap,
            init.coalesced_events.into_iter().flatten(),
        ));
        this.set_predicted(Refs::collect(
            heap,
            init.predicted_events.into_iter().flatten(),
        ));
        Ok(this)
    }

    pub(crate) fn pointer(&self) -> &PointerData {
        &self.pointer
    }

    pub(crate) fn get_pointer_id(&self) -> i32 {
        self.pointer.id
    }

    pub(crate) fn get_width(&self) -> f64 {
        self.pointer.size[0]
    }

    pub(crate) fn get_height(&self) -> f64 {
        self.pointer.size[1]
    }

    pub(crate) fn get_pressure(&self) -> f64 {
        self.pointer.pressure.into()
    }

    pub(crate) fn get_tangential_pressure(&self) -> f64 {
        self.pointer.tangential_pressure.into()
    }

    pub(crate) fn get_tilt_x(&self) -> i32 {
        self.pointer.tilt[0]
    }

    pub(crate) fn get_tilt_y(&self) -> i32 {
        self.pointer.tilt[1]
    }

    pub(crate) fn get_twist(&self) -> i32 {
        self.pointer.twist
    }

    pub(crate) fn get_altitude_angle(&self) -> f64 {
        self.pointer.angles[0]
    }

    pub(crate) fn get_azimuth_angle(&self) -> f64 {
        self.pointer.angles[1]
    }

    pub(crate) fn get_pointer_type(&self) -> &Atom {
        &self.pointer.kind
    }

    pub(crate) fn get_is_primary(&self) -> bool {
        self.pointer.is_primary
    }

    pub(crate) fn get_persistent_device_id(&self) -> i32 {
        self.pointer.persistent_device_id
    }

    pub(crate) fn get_coalesced_events<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        let name = self.name();
        let coalesces = self.is_trusted()
            && self.get_composed()
            && matches!(name, atom!("pointermove") | atom!("pointerrawupdate"));
        if let Some(target) = self.target_node().filter(|_| coalesces) {
            let only = self.coalesced().first().unwrap_or_else(|| {
                let made = PointerEvent::new(
                    heap,
                    target.doc(),
                    name,
                    PLAIN,
                    Trusted::Yes,
                    0,
                    self.mouse(),
                    self.pointer.clone(),
                );
                made.set_time(self.time());
                self.set_coalesced(Refs::collect(heap, [made]));
                made
            });
            only.set_target(Some(target.to_js()));
        }
        self.coalesced().to_array(heap)
    }

    pub(crate) fn get_predicted_events<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        self.predicted().to_array(heap)
    }
}

#[repr(C)]
pub(crate) struct WheelEvent {
    pub(crate) base: MouseEvent,
    delta: [f64; 3],
    mode: u32,
    is_from_momentum: bool,
}

impl WheelEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        init: EventInit,
        mouse: Mouse,
        [x, y]: [f64; 2],
    ) -> &'a Event {
        let base = MouseEvent::base(
            UIEvent::base(atom!("wheel"), init, Trusted::Yes, 0, 0),
            mouse,
        );
        let this = js_WheelEvent::create(
            doc.heap(heap),
            WheelEvent {
                base,
                delta: [x, y, 0.0],
                mode: 0,
                is_from_momentum: false,
            },
        );
        this.set_view(host::window(doc));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &WheelEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let delta = [init.delta_x, init.delta_y, init.delta_z];
        let this = structure.create(
            heap,
            WheelEvent {
                base: mouse_base!(name, init),
                delta,
                mode: init.delta_mode,
                is_from_momentum: init.momentum,
            },
        );
        set_mouse_fields!(heap, this, init);
        Ok(this)
    }

    pub(crate) fn get_delta_x(&self) -> f64 {
        self.delta[0]
    }

    pub(crate) fn get_delta_y(&self) -> f64 {
        self.delta[1]
    }

    pub(crate) fn get_delta_z(&self) -> f64 {
        self.delta[2]
    }

    pub(crate) fn get_delta_mode(&self) -> u32 {
        self.mode
    }

    pub(crate) fn get_momentum(&self) -> bool {
        self.is_from_momentum
    }

    pub(crate) fn get_wheel_delta_x(&self) -> i32 {
        (-1.2 * self.delta[0]).round() as i32
    }

    pub(crate) fn get_wheel_delta_y(&self) -> i32 {
        (-1.2 * self.delta[1]).round() as i32
    }

    pub(crate) fn get_wheel_delta(&self) -> i32 {
        Some(self.get_wheel_delta_y())
            .filter(|it| *it != 0)
            .unwrap_or_else(|| self.get_wheel_delta_x())
    }
}

#[repr(C)]
pub(crate) struct DragEvent {
    pub(crate) base: MouseEvent,
    pub(crate) fields: js_DragEvent::Fields,
}

slots!(DragEvent = js_DragEvent set { data_transfer: DataTransfer, });

impl DragEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        mouse: Mouse,
        data: &DataTransfer,
    ) -> &'a Event {
        let base = MouseEvent::base(UIEvent::base(name, init, Trusted::Yes, 0, 0), mouse);
        let this = js_DragEvent::create(
            doc.heap(heap),
            DragEvent {
                base,
                fields: Default::default(),
            },
        );
        this.set_view(host::window(doc));
        this.set_data_transfer(Some(data));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DragEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(
            heap,
            DragEvent {
                base: mouse_base!(name, init),
                fields: Default::default(),
            },
        );
        set_mouse_fields!(heap, this, init);
        this.set_data_transfer(init.data_transfer);
        Ok(this)
    }
}
