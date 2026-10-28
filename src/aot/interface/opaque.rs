use core::any::Any;

pub struct Opaque(Box<dyn Any>);

impl Opaque {
    pub fn new<T: Any>(value: T) -> Opaque {
        Opaque(Box::new(value))
    }

    pub fn get<T: Any>(&self) -> &T {
        self.0.downcast_ref().expect("a value of another type")
    }
}
