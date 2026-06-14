// EXP-057: 17-site `fn(&self) -> &'a mut T` caller-chosen-`'a` cluster.
//
// Mirrors the F-L-1 shape across 17 sites (install/, http/, sql_jsc/, ...):
//
//   impl Container {
//       fn inner_mut<'a>(&'a self) -> &'a mut Inner {
//           unsafe { &mut *self.inner }  // raw ptr deref, caller picks 'a
//       }
//   }
//
// Two interleaved calls on `&self` mint coexisting `&mut Inner` to the same
// allocation without borrowck noticing. Under `-Zmiri-tree-borrows`, the
// second `&mut` reborrow should be rejected because the first one is still
// live (and any write through it would disable the second's tag).

struct Inner {
    x: u32,
}

struct Container {
    inner: *mut Inner,
}

impl Container {
    /// Mirrors the 17-site signature: `fn(&self) -> &'a mut T`.
    /// The `'a` is caller-chosen, unconstrained by the input lifetime
    /// since `*mut Inner` carries no lifetime.
    fn inner_mut<'a>(&'a self) -> &'a mut Inner {
        unsafe { &mut *self.inner }
    }
}

fn main() {
    let inner = Box::leak(Box::new(Inner { x: 0 }));
    let c = Container { inner };

    // Two simultaneously-live `&mut Inner` minted from `&c`:
    let a = c.inner_mut();
    let b = c.inner_mut();

    // Writes through both — Tree Borrows tags `a` as the parent of `b`,
    // and the write through `a` disables `b`'s tag. The next write through
    // `b` is then UB.
    a.x = 1;
    b.x = 2; // ← Miri-TB: write access through disabled tag.

    println!("final x = {}", c.inner_mut().x);

    // Reclaim the leaked Box so Miri does not also flag a memory leak
    // unrelated to the finding under test.
    unsafe { drop(Box::from_raw(inner as *mut Inner)) };
}
