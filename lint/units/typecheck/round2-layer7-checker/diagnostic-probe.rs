//! Probe of ast/diagnostic.rs: the file of the tree, by #[path], beside the real files it names, with the calls of checker/c02, c21, c22 and c24 as those files write them.
//! Real files by #[path]: ast/{diagnostic,ids}.rs, core/text.rs, diagnostics/, stringutil/. Stand-in: core::ResolutionMode (the derive list of core/compileroptions.rs 364).
//! Run: sh diagnostic-probe.sh (rustc and clippy-driver alone, then the five tests at the end of this file and the tests of diagnostic-slices-test.py).
#![allow(dead_code)]
#![deny(warnings)]
#![deny(
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_pub,
    unused_assignments,
    unused_macros,
    unreachable_code,
    unreachable_patterns
)]

pub mod ast {
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/diagnostic.rs"]
    pub mod diagnostic;
    #[path = "/workspace/wt/typecheck/src/typecheck/ast/ids.rs"]
    pub mod ids;
    pub use diagnostic::*;
    pub use ids::*;
}

pub mod core {
    #[path = "/workspace/wt/typecheck/src/typecheck/core/text.rs"]
    pub mod text;
    pub use text::*;

    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
    pub struct ModuleKind(pub i32);
    pub type ResolutionMode = ModuleKind;
}

#[path = "/workspace/wt/typecheck/src/typecheck/diagnostics/mod.rs"]
pub mod diagnostics;
#[path = "/workspace/wt/typecheck/src/typecheck/stringutil/mod.rs"]
pub mod stringutil;

// The calls of checker/c02, c21, c22 and c24, as those files write them.
pub mod consumer {
    use crate::ast::{
        Arg, DiagnosticId, DiagnosticStore, Diagnostics, DiagnosticsCollection, NodeId,
        RepopulateDiagnosticInfo, RepopulateDiagnosticKind, SourceFiles,
    };
    use crate::core::{ResolutionMode, TextRange};
    use crate::diagnostics::{self, Category};

    pub struct ProgramFiles<'a> {
        pub names: &'a [&'a [u8]],
    }

    impl SourceFiles for ProgramFiles<'_> {
        fn file_name(&self, file: NodeId) -> &[u8] {
            match self.find(file) {
                Some(name) => name,
                None => b"",
            }
        }
        fn path(&self, file: NodeId) -> &[u8] {
            match self.find(file) {
                Some(name) => name,
                None => b"",
            }
        }
        fn text(&self, file: NodeId) -> &[u8] {
            match self.find(file) {
                Some(name) => name,
                None => b"",
            }
        }
        fn ecma_line_map(&self, _: NodeId) -> &[i32] {
            &[]
        }
    }

    impl<'a> ProgramFiles<'a> {
        fn find(&self, file: NodeId) -> Option<&'a [u8]> {
            self.names.get(file.0 as usize).copied()
        }
    }

    #[derive(Default)]
    pub struct Checker<'a> {
        pub names: &'a [&'a [u8]],
        pub diagnostic_store: DiagnosticStore,
        pub diagnostics: DiagnosticsCollection,
        pub suggestion_diagnostics: DiagnosticsCollection,
    }

    fn compare_diagnostics(c: &Checker<'_>, d1: DiagnosticId, d2: DiagnosticId) -> isize {
        let files = ProgramFiles { names: c.names };
        let view = Diagnostics {
            store: &c.diagnostic_store,
            files: &files,
        };
        view.compare_diagnostics(d1, d2)
    }

    impl<'a> Checker<'a> {
        pub fn zero(names: &'a [&'a [u8]]) -> Self {
            Self {
                names,
                diagnostic_store: Default::default(),
                diagnostics: Default::default(),
                suggestion_diagnostics: Default::default(),
            }
        }

        pub fn get_diagnostics(&mut self, source_file: NodeId, suggestion: bool) -> Vec<DiagnosticId> {
            let files = ProgramFiles { names: self.names };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            if suggestion {
                return self
                    .suggestion_diagnostics
                    .get_diagnostics_for_file(view, source_file);
            }
            self.diagnostics.get_diagnostics_for_file(view, source_file)
        }

        pub fn get_global_diagnostics(&mut self) -> Vec<DiagnosticId> {
            let files = ProgramFiles { names: self.names };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            self.diagnostics.get_global_diagnostics(view)
        }

        pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
            let files = ProgramFiles { names: self.names };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            self.diagnostics.add(view, diagnostic)
        }

        pub fn add_suggestion_diagnostic(&mut self, diagnostic: DiagnosticId) -> DiagnosticId {
            let suggestion = self.diagnostic_store.clone_diagnostic(diagnostic);
            self.diagnostic_store[suggestion].set_category(Category::Suggestion);
            let files = ProgramFiles { names: self.names };
            let view = Diagnostics {
                store: &self.diagnostic_store,
                files: &files,
            };
            self.suggestion_diagnostics.add(view, suggestion)
        }

        pub fn create_module_not_found_chain(
            &mut self,
            file: NodeId,
            module_reference: &[u8],
            mode: ResolutionMode,
            package_name: &[u8],
        ) -> DiagnosticId {
            let mut stored_package_name = package_name;
            if stored_package_name == module_reference {
                stored_package_name = b"";
            }
            let args = [Arg::Str(module_reference)];
            let result = self.diagnostic_store.new_diagnostic(
                file,
                TextRange::default(),
                diagnostics::CANNOT_FIND_NAME_0,
                &args,
            );
            self.diagnostic_store[result].set_repopulate_info(RepopulateDiagnosticInfo {
                kind: RepopulateDiagnosticKind::MODULE_NOT_FOUND,
                module_reference: module_reference.to_vec(),
                mode,
                package_name: stored_package_name.to_vec(),
            });
            result
        }

        pub fn create_mode_mismatch_details(&mut self, file: NodeId) -> DiagnosticId {
            let result = self.diagnostic_store.new_diagnostic(
                file,
                TextRange::default(),
                diagnostics::CANNOT_FIND_NAME_0,
                &[],
            );
            self.diagnostic_store[result].set_repopulate_info(RepopulateDiagnosticInfo {
                kind: RepopulateDiagnosticKind::MODE_MISMATCH,
                ..RepopulateDiagnosticInfo::default()
            });
            result
        }

        pub fn same(&self, d1: DiagnosticId, d2: DiagnosticId) -> bool {
            compare_diagnostics(self, d1, d2) == 0
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::ast::{
        Arg, DiagnosticId, DiagnosticStore, Diagnostics, DiagnosticsCollection, NodeId,
        RepopulateDiagnosticInfo, RepopulateDiagnosticKind, SourceFiles,
    };
    use crate::core::{ModuleKind, TextRange, new_text_range};
    use crate::diagnostics;

    // File 1 is b.ts and file 2 is a.ts, so the order of the names is not the order of the ids.
    struct Files;
    impl SourceFiles for Files {
        fn file_name(&self, file: NodeId) -> &[u8] {
            match file.0 {
                1 => b"b.ts",
                2 => b"a.ts",
                _ => b"",
            }
        }
        fn path(&self, file: NodeId) -> &[u8] {
            self.file_name(file)
        }
        fn text(&self, _: NodeId) -> &[u8] {
            b""
        }
        fn ecma_line_map(&self, _: NodeId) -> &[i32] {
            &[]
        }
    }

    fn view(store: &DiagnosticStore) -> Diagnostics<'_, Files> {
        Diagnostics {
            store,
            files: &Files,
        }
    }

    fn at(store: &mut DiagnosticStore, file: u32, pos: i32, end: i32, name: &[u8]) -> DiagnosticId {
        store.new_diagnostic(
            NodeId(file),
            new_text_range(pos, end),
            diagnostics::CANNOT_FIND_NAME_0,
            &[Arg::Str(name)],
        )
    }

    #[test]
    fn add_keeps_one_of_equal_diagnostics_and_both_of_a_collision() {
        let mut store = DiagnosticStore::default();
        let mut c = DiagnosticsCollection::default();
        let d1 = at(&mut store, 1, 3, 5, b"x");
        let d2 = at(&mut store, 1, 3, 5, b"x");
        let d3 = at(&mut store, 1, 3, 5, b"y");
        let d4 = at(&mut store, 1, 3, 5, b"y");
        let d0 = at(&mut store, 1, 3, 5, b"a");
        assert_eq!(c.add(view(&store), d1), d1);
        assert_eq!(c.add(view(&store), d2), d1);
        assert_eq!(c.add(view(&store), d3), d3);
        assert_eq!(c.add(view(&store), d4), d3);
        assert_eq!(c.add(view(&store), d0), d0);
        assert_eq!(c.add(view(&store), d0), d0);
        assert_eq!(c.add(view(&store), DiagnosticId::NIL), DiagnosticId::NIL);
        // Same place and code: the arguments decide.
        assert_eq!(c.get_diagnostics_for_file(view(&store), NodeId(1)), [d0, d1, d3]);
        assert_eq!(c.get_diagnostics_for_file(view(&store), NodeId(2)), []);
        assert_eq!(c.get_global_diagnostics(view(&store)), []);
        assert_eq!(c.get_diagnostics(view(&store)), [d0, d1, d3]);
        // An equal diagnostic that was not added is found, another one is not.
        assert_eq!(c.lookup(view(&store), d4), d3);
        assert_eq!(c.lookup(view(&store), d2), d1);
        let other = at(&mut store, 1, 3, 5, b"z");
        assert_eq!(c.lookup(view(&store), other), DiagnosticId::NIL);
        let elsewhere = at(&mut store, 2, 3, 5, b"x");
        assert_eq!(c.lookup(view(&store), elsewhere), DiagnosticId::NIL);
    }

    #[test]
    fn the_getters_sort_by_path_place_code_and_keep_the_order_of_equals() {
        let mut store = DiagnosticStore::default();
        let mut c = DiagnosticsCollection::default();
        let b10 = at(&mut store, 1, 10, 12, b"x");
        let b2 = at(&mut store, 1, 2, 9, b"x");
        let b2_short = at(&mut store, 1, 2, 4, b"x");
        let a7 = at(&mut store, 2, 7, 8, b"x");
        let g2 = store.new_compiler_diagnostic(diagnostics::X_0_IS_DEPRECATED, &[Arg::Str(b"g")]);
        let g1 = store.new_compiler_diagnostic(diagnostics::CANNOT_FIND_NAME_0, &[Arg::Str(b"g")]);
        let b2_other_code = store.new_diagnostic(
            NodeId(1),
            new_text_range(2, 4),
            diagnostics::X_0_IS_DEPRECATED,
            &[Arg::Str(b"x")],
        );
        for d in [b10, b2, b2_short, a7, g2, g1, b2_other_code] {
            assert_eq!(c.add(view(&store), d), d);
        }
        assert_eq!(
            c.get_diagnostics_for_file(view(&store), NodeId(1)),
            [b2_short, b2_other_code, b2, b10]
        );
        assert_eq!(c.get_diagnostics_for_file(view(&store), NodeId(2)), [a7]);
        // 2304 before 6385.
        assert_eq!(c.get_global_diagnostics(view(&store)), [g1, g2]);
        // No file, then a.ts (file 2), then b.ts (file 1).
        assert_eq!(
            c.get_diagnostics(view(&store)),
            [g1, g2, a7, b2_short, b2_other_code, b2, b10]
        );
        // A diagnostic that is added later is sorted in by the next read.
        let b0 = at(&mut store, 1, 0, 1, b"x");
        assert_eq!(c.add(view(&store), b0), b0);
        assert_eq!(
            c.get_diagnostics_for_file(view(&store), NodeId(1)),
            [b0, b2_short, b2_other_code, b2, b10]
        );
        let v = view(&store);
        assert!(v.compare_diagnostics(a7, b0) < 0);
        assert!(v.compare_diagnostics(b0, a7) > 0);
        assert_eq!(v.compare_diagnostics(b0, b0), 0);
        assert!(v.compare_diagnostics(g2, a7) < 0);
    }

    #[test]
    fn chains_and_related_information_take_part() {
        let mut store = DiagnosticStore::default();
        let plain = at(&mut store, 1, 3, 5, b"x");
        let inner = at(&mut store, 1, 3, 5, b"inner");
        let chained = at(&mut store, 1, 3, 5, b"x");
        store.add_message_chain(chained, inner);
        let inner_b = at(&mut store, 1, 3, 5, b"inner b");
        let chained_b = at(&mut store, 1, 3, 5, b"x");
        store.add_message_chain(chained_b, inner_b);
        let related = at(&mut store, 2, 1, 2, b"r");
        let with_related = at(&mut store, 1, 3, 5, b"x");
        store.add_related_info(with_related, related);
        let v = view(&store);
        // The longer chain first, then the arguments of the chain, then the more related information first.
        assert!(v.compare_diagnostics(chained, plain) < 0);
        assert!(v.compare_diagnostics(plain, chained) > 0);
        assert!(v.compare_diagnostics(chained, chained_b) < 0);
        assert!(v.compare_diagnostics(with_related, plain) < 0);
        assert!(!v.equal_diagnostics(chained, plain));
        assert!(!v.equal_diagnostics(chained, chained_b));
        assert!(v.equal_diagnostics_no_related_info(with_related, plain));
        assert!(!v.equal_diagnostics(with_related, plain));
        assert!(v.equal_diagnostics(plain, plain));
        let mut c = DiagnosticsCollection::default();
        for d in [plain, chained, chained_b, with_related] {
            assert_eq!(c.add(v, d), d);
        }
        assert_eq!(
            c.get_diagnostics_for_file(v, NodeId(1)),
            [chained, chained_b, with_related, plain]
        );
    }

    #[test]
    fn an_ad_hoc_message_is_compared_by_its_text() {
        let mut store = DiagnosticStore::default();
        let range = TextRange::default();
        let b = store.new_ad_hoc_diagnostic(NodeId::NIL, range, b"b");
        let a = store.new_ad_hoc_diagnostic(NodeId::NIL, range, b"a");
        let bang = store.new_ad_hoc_diagnostic(NodeId::NIL, range, b"!");
        let empty = store.new_ad_hoc_diagnostic(NodeId::NIL, range, b"");
        let empty_too = store.new_ad_hoc_diagnostic(NodeId::NIL, range, b"");
        let v = view(&store);
        assert!(v.compare_diagnostics(a, b) < 0);
        assert!(v.compare_diagnostics(empty, bang) < 0);
        assert!(v.compare_diagnostics(bang, empty) > 0);
        assert_eq!(v.compare_diagnostics(empty, empty_too), 0);
        assert!(v.equal_diagnostics(empty, empty_too));
        let mut c = DiagnosticsCollection::default();
        for d in [b, a, bang, empty] {
            assert_eq!(c.add(v, d), d);
        }
        assert_eq!(c.add(v, empty_too), empty);
        assert_eq!(c.get_global_diagnostics(v), [empty, bang, a, b]);
    }

    #[test]
    fn the_repopulate_info_is_kept_and_copied() {
        let mut store = DiagnosticStore::default();
        let d = at(&mut store, 1, 3, 5, b"x");
        assert!(store[d].repopulate_info().is_none());
        store[d].set_repopulate_info(RepopulateDiagnosticInfo {
            kind: RepopulateDiagnosticKind::MODULE_NOT_FOUND,
            module_reference: b"m".to_vec(),
            mode: ModuleKind(1),
            package_name: b"p".to_vec(),
        });
        let copy = store.clone_diagnostic(d);
        for id in [d, copy] {
            let info = store[id].repopulate_info().cloned().unwrap_or_default();
            assert_eq!(info.kind, RepopulateDiagnosticKind::MODULE_NOT_FOUND);
            assert_eq!(info.kind.0, 2);
            assert_eq!(info.module_reference, b"m");
            assert_eq!(info.mode, ModuleKind(1));
            assert_eq!(info.package_name, b"p");
        }
        store[d].set_repopulate_info(RepopulateDiagnosticInfo {
            kind: RepopulateDiagnosticKind::MODE_MISMATCH,
            ..RepopulateDiagnosticInfo::default()
        });
        assert_eq!(
            store[d].repopulate_info(),
            Some(&RepopulateDiagnosticInfo {
                kind: RepopulateDiagnosticKind(1),
                module_reference: Vec::new(),
                mode: ModuleKind(0),
                package_name: Vec::new(),
            })
        );
        // A write through nil lands in the scratch diagnostic.
        store[DiagnosticId::NIL].set_repopulate_info(RepopulateDiagnosticInfo::default());
        assert!(store[DiagnosticId::NIL].repopulate_info().is_none());
    }
}
