use super::*;
use crate::generated_bindgen::uievents::{
    TouchEventInit, TouchInit, js_Touch, js_TouchEvent, js_TouchList,
};

#[derive(Clone)]
pub(crate) struct Touch {
    pub(crate) identifier: i32,
    pub(crate) screen: [f64; 2],
    pub(crate) client: [f64; 2],
    pub(crate) page: [f64; 2],
    pub(crate) radius: [f32; 2],
    pub(crate) rotation_angle: f32,
    pub(crate) force: f32,
    pub(crate) _interior: bun_jsc::bindgen::Interior,
}

slots!(TouchList = js_TouchList {} [touches: Touch,]);

macro_rules! measures {
    ($($name:ident = $field:ident $([$index:literal])?,)+) => {$(
        pub(crate) fn $name(&self) -> f64 {
            self.$field$([$index])?.into()
        }
    )+};
}

impl Touch {
    pub(crate) fn on<'a>(self, heap: &JsHeap<'a>, target: &Node) -> &'a Touch {
        let this = js_Touch::create(target.doc().heap(heap), self);
        js_Touch::set_target(this, target.to_js());
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        init: &TouchInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let target = event_target(heap, Some(init.target))?;
        let this = structure.create(
            heap,
            Touch {
                identifier: init.identifier,
                screen: [init.screen_x, init.screen_y],
                client: [init.client_x, init.client_y],
                page: [init.page_x, init.page_y],
                radius: [init.radius_x, init.radius_y],
                rotation_angle: init.rotation_angle,
                force: init.force,
                _interior: Default::default(),
            },
        );
        js_Touch::set_target(this, target.unwrap_or(JSValue::NULL));
        Ok(this)
    }

    pub(crate) fn get_identifier(&self) -> i32 {
        self.identifier
    }

    measures! {
        get_screen_x = screen[0], get_screen_y = screen[1], get_client_x = client[0], get_client_y = client[1], get_page_x = page[0],
        get_page_y = page[1], get_radius_x = radius[0], get_radius_y = radius[1], get_rotation_angle = rotation_angle, get_force = force,
    }
}

impl TouchList {
    fn new<'a, 'b>(
        heap: &JsHeap<'a>,
        touches: impl IntoIterator<Item = &'b Touch>,
    ) -> &'a TouchList {
        let this = js_TouchList::create(heap, Default::default());
        this.set_touches(Refs::collect(heap, touches));
        this
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.touches().len() as u32
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<&Touch> {
        self.touches().get(index as usize)
    }
}

#[repr(C)]
pub(crate) struct TouchEvent {
    pub(crate) base: UIEvent,
    pub(crate) fields: js_TouchEvent::Fields,
    modifiers: Modifiers,
}

modifier_getters!(TouchEvent);
slots!(TouchEvent = js_TouchEvent set { touches: TouchList, target_touches: TouchList, changed_touches: TouchList, });

impl TouchEvent {
    /// All the touches, those on the target, and those that have changed.
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        modifiers: Modifiers,
        lists: [Refs<'_, Touch>; 3],
    ) -> &'a Event {
        let heap = doc.heap(heap);
        let this = js_TouchEvent::create(
            heap,
            TouchEvent {
                base: UIEvent::base(name, init, Trusted::Yes, 0, 0),
                fields: Default::default(),
                modifiers,
            },
        );
        this.set_view(host::window(doc));
        this.set_lists(heap, lists.map(Refs::iter));
        this
    }

    fn set_lists<'b>(
        &self,
        heap: &JsHeap<'_>,
        [all, on_target, changed]: [impl Iterator<Item = &'b Touch>; 3],
    ) {
        self.set_touches(Some(TouchList::new(heap, all)));
        self.set_target_touches(Some(TouchList::new(heap, on_target)));
        self.set_changed_touches(Some(TouchList::new(heap, changed)));
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &TouchEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(
            heap,
            TouchEvent {
                base: ui_base!(name, init),
                fields: Default::default(),
                modifiers: modifiers!(init),
            },
        );
        this.set_view(window(heap, init.view)?);
        this.set_lists(
            heap,
            [init.touches, init.target_touches, init.changed_touches]
                .map(|it| it.into_iter().flatten()),
        );
        Ok(this)
    }

    fn modifiers(&self) -> Modifiers {
        self.modifiers
    }
}
