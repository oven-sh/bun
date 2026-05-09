// Integration test — proc-macro crates can't unit-test their own macros
// (the host crate is compiled as a dylib, not linked into the test binary).

bun_dispatch::link_interface! {
    pub Shape[Circle, Square] {
        fn area() -> f64;
        fn scale(k: f64);
        fn name() -> &'static str;
        fn label(prefix: &str, out: &mut String);
    }
}

pub struct CircleT {
    r: f64,
}
pub struct SquareT {
    s: f64,
}

link_impl_Shape! {
    Circle for CircleT => |this| {
        area()    => core::f64::consts::PI * (*this).r * (*this).r,
        scale(k)  => (*this).r *= k,
        name()    => "circle",
        label(prefix, out) => { out.push_str(prefix); out.push_str("circle"); },
    }
}

link_impl_Shape! {
    Square for SquareT => |this| {
        area()    => (*this).s * (*this).s,
        scale(k)  => (*this).s *= k,
        name()    => "square",
        label(prefix, out) => { out.push_str(prefix); out.push_str("square"); },
    }
}

#[test]
fn dispatch_round_trip() {
    let mut c = CircleT { r: 2.0 };
    let mut s = SquareT { s: 3.0 };
    // SAFETY: c/s are live for the duration of every dispatch below.
    let hc = unsafe { Shape::new(ShapeKind::Circle, &raw mut c) };
    let hs = unsafe { Shape::new(ShapeKind::Square, &raw mut s) };

    assert!((hc.area() - core::f64::consts::PI * 4.0).abs() < 1e-9);
    assert_eq!(hs.area(), 9.0);
    assert_eq!(hc.name(), "circle");
    assert_eq!(hs.name(), "square");
    assert!(hc.is(ShapeKind::Circle));
    assert!(!hc.is(ShapeKind::Square));

    hc.scale(2.0);
    hs.scale(2.0);
    assert!((hc.area() - core::f64::consts::PI * 16.0).abs() < 1e-9);
    assert_eq!(hs.area(), 36.0);

    let mut buf = String::new();
    hc.label("a ", &mut buf);
    hs.label(" / a ", &mut buf);
    assert_eq!(buf, "a circle / a square");
}
