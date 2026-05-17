#![deny(unsafe_op_in_unsafe_fn)]

// Faithful model of:
//   src/bundler/transpiler.rs:262
//     pub fn env_mut(&self) -> &'a mut dot_env::Loader<'a> {
//         unsafe { &mut *self.env }
//     }
//
// The real `Transpiler<'static>` stores `env: *mut Loader<'static>`.
// Because the method takes `&self`, safe code can call it twice and obtain two
// coexisting `&'static mut Loader` references to the same allocation.

#[derive(Default)]
struct Loader {
    value: usize,
}

struct Transpiler<'a> {
    env: *mut Loader,
    _marker: core::marker::PhantomData<&'a mut Loader>,
}

impl<'a> Transpiler<'a> {
    #[allow(clippy::mut_from_ref)]
    fn env_mut(&self) -> &'a mut Loader {
        // Mirrors Bun's `Transpiler::env_mut`: raw pointer -> unbounded `&mut`
        // from a shared receiver.
        unsafe { &mut *self.env }
    }
}

fn main() {
    let leaked: &'static mut Loader = Box::leak(Box::new(Loader::default()));
    let t = Transpiler::<'static> {
        env: leaked as *mut Loader,
        _marker: core::marker::PhantomData,
    };

    let first = t.env_mut();
    let second = t.env_mut();

    first.value = 1;
    second.value = 2;
    std::hint::black_box(first.value);
    std::hint::black_box(second.value);
}

