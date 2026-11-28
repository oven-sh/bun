//! What can't be a kernel.
use super::*;

pub(super) fn kernel(it: &Item, words: V, of: Option<&Item>, list: &[T]) -> V {
    let head = &it.rest[..it.rest.len() - 1];
    let why = match () {
        _ if is(
            &head[it.kind + 1],
            "u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f16 f32 f64 f128 bool char str",
        ) =>
        {
            "a kernel makes a type with its name, which would hide the primitive one"
        }
        _ if it.kind > 0 => "a kernel can't be const, async, unsafe or extern: call it from such a function",
        _ if it.find("target_feature").is_some() => {
            "a kernel has the features of its targets: name them, as in #[kernel(avx2)]"
        }
        _ if names(&it.attrs(|v| is(&v[0], "cfg_attr")), "only except") => {
            "only and except can't be in a cfg_attr here: take cfg, and write the kernel twice"
        }
        _ if it.unread() => UNREAD,
        _ if it.find("track_caller").is_some() => {
            "a kernel is called through a pointer, which doesn't pass the place of the call"
        }
        _ if names(head, "S") || of.is_some_and(Item::declares) => {
            "a kernel chooses its target, so its signature can't depend on it: take slices or arrays, or #[simd] in the place of #[kernel]. A trait in its bounds has #[simd] on each method and type, so that the trait is the same for all targets"
        }
        _ if names(&signature(it).result, "impl") => "the result of a kernel is the same type for all targets: name it",
        _ if of.is_some_and(Item::given) => "the method of a trait can't be a kernel: call one from it",
        _ if of.is_none() && (!signature(it).this.is_empty() || names(head, "Self")) => {
            "the impl of a method that is a kernel needs #[simd]"
        }
        _ => return super::kernel::kernel(it, words, of, list),
    };
    [it.attrs(|v| is(&v[0], "cfg")), error(why)].concat()
}
