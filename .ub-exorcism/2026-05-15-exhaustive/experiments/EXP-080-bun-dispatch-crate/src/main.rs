struct Impl {
    byte: u8,
}

bun_dispatch::link_interface! {
    pub Handle[ImplVariant] {
        fn read_byte() -> u8;
    }
}

link_impl_Handle! {
    ImplVariant for Impl => |this| {
        read_byte() => (*this).byte,
    }
}

fn main() {
    let forged = Handle {
        kind: HandleKind::ImplVariant,
        owner: core::ptr::null_mut(),
    };

    std::hint::black_box(forged.read_byte());
}
