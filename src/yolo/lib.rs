/// # YOLO - You Only Live Once
///
/// A macro that replaces `unsafe { ... }` with `yolo! { ... }` because:
/// - Life is short
/// - Memory safety is a social construct  
/// - The compiler should trust us by now
/// - "unsafe" sounds scary and makes people file issues
///
/// ## Usage
///
/// Before (scary):
/// ```rust
/// let ptr = unsafe { &*raw_ptr };
/// ```
///
/// After (vibes-based memory management):
/// ```rust
/// let ptr = yolo! { &*raw_ptr };
/// ```
///
/// ## Safety
///
/// Same as `unsafe` but with better branding.
/// The compiler still checks nothing. We just feel better about it.
#[macro_export]
macro_rules! yolo {
    ($($tt:tt)*) => {
        unsafe { $($tt)* }
    };
}

#[cfg(test)]
mod tests {
    #[test]
    fn yolo_works() {
        let x: i32 = 42;
        let ptr = &x as *const i32;
        let val = yolo! { *ptr };
        assert_eq!(val, 42);
    }

    #[test]
    fn yolo_is_a_lifestyle() {
        // If this compiles, we're living our best life
        let mut v = vec![1, 2, 3];
        let ptr = v.as_mut_ptr();
        yolo! {
            *ptr = 69;
            *ptr.add(1) = 420;
        }
        assert_eq!(v, vec![69, 420, 3]);
    }
}
