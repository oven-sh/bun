#![feature(allocator_api)]

use std::mem::needs_drop;

fn report<T>(name: &str) {
    println!("{name}\t{}", needs_drop::<T>());
}

fn report_vec<T>(name: &str) {
    println!("Vec<{name}, AstAlloc>\t{}", needs_drop::<Vec<T, bun_alloc::AstAlloc>>());
}

fn main() {
    report::<bun_ast::Expr>("Expr");
    report::<bun_ast::Stmt>("Stmt");
    report::<bun_ast::G::Decl>("G::Decl");
    report::<bun_ast::G::Property>("G::Property");
    report::<bun_ast::B::Property>("B::Property");
    report::<bun_ast::Ref>("Ref");
    report::<bun_ast::StoreRef<bun_ast::Scope>>("StoreRef<Scope>");
    report::<u8>("u8");

    report_vec::<bun_ast::Expr>("Expr");
    report_vec::<bun_ast::Stmt>("Stmt");
    report_vec::<bun_ast::G::Decl>("G::Decl");
    report_vec::<bun_ast::G::Property>("G::Property");
    report_vec::<bun_ast::B::Property>("B::Property");
    report_vec::<bun_ast::Ref>("Ref");
    report_vec::<bun_ast::StoreRef<bun_ast::Scope>>("StoreRef<Scope>");
    report_vec::<u8>("u8");
}
