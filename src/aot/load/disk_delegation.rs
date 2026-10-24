macro_rules! delegate_host_services_to_disk {
    ($disk:ident) => {
        fn origin(&self, path: &[u8]) -> usize {
            bun_sema::resolve::Host::origin(self.$disk, path)
        }

        fn is_case_sensitive(&self) -> bool {
            bun_sema::resolve::Host::is_case_sensitive(self.$disk)
        }

        fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>> {
            bun_sema::resolve::Host::scripts_of_page(self.$disk, page)
        }

        fn parse<'tree>(
            &self,
            arena: &'tree bun_sema::session::Arena,
            path: &[u8],
            text: &[u8],
            atoms: &bun_sema::atom::Interner<'tree>,
            options: bun_sema::resolve::ParseOptions,
        ) -> bun_sema::hir::File<'tree> {
            bun_sema::resolve::Host::parse(self.$disk, arena, path, text, atoms, options)
        }

        fn parse_top_level<'tree>(
            &self,
            arena: &'tree bun_sema::session::Arena,
            path: &[u8],
            text: &[u8],
            atoms: &bun_sema::atom::Interner<'tree>,
            options: bun_sema::resolve::ParseOptions,
        ) -> Option<bun_sema::hir::File<'tree>> {
            bun_sema::resolve::Host::parse_top_level(self.$disk, arena, path, text, atoms, options)
        }

        fn parse_package_json(
            &self,
            arena: &bun_sema::session::Arena,
            text: &[u8],
        ) -> Option<bun_sema::json::Json> {
            bun_sema::resolve::Host::parse_package_json(self.$disk, arena, text)
        }

        fn extended_config(&self, path: &[u8]) -> Option<bun_sema::resolve::CachedConfig> {
            bun_sema::resolve::Host::extended_config(self.$disk, path)
        }

        fn cache_extended_config(
            &self,
            path: &[u8],
            parsed: &dyn Fn() -> bun_sema::resolve::CachedConfig,
        ) {
            bun_sema::resolve::Host::cache_extended_config(self.$disk, path, parsed);
        }

        fn shared_paths(
            &self,
            paths: std::sync::Arc<bun_sema::resolve::Paths>,
        ) -> std::sync::Arc<bun_sema::resolve::Paths> {
            bun_sema::resolve::Host::shared_paths(self.$disk, paths)
        }

        fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
            bun_sema::resolve::Host::parallel(self.$disk, count, work);
        }

        fn parallel_while(
            &self,
            count: usize,
            work: &(dyn Fn(usize) + Sync),
            meanwhile: &mut dyn FnMut(),
        ) {
            bun_sema::resolve::Host::parallel_while(self.$disk, count, work, meanwhile);
        }

        fn run_regions_inline(&self, work: &mut dyn FnMut()) {
            bun_sema::resolve::Host::run_regions_inline(self.$disk, work);
        }

        fn is_single_threaded(&self) -> bool {
            bun_sema::resolve::Host::is_single_threaded(self.$disk)
        }

        fn helpers_now(&self) -> Option<usize> {
            bun_sema::resolve::Host::helpers_now(self.$disk)
        }

        fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
            bun_sema::resolve::Host::with_helpers(self.$disk, helpers, count, work);
        }

        fn loaded(&self) {
            bun_sema::resolve::Host::loaded(self.$disk);
        }

        fn threads(&self) -> usize {
            bun_sema::resolve::Host::threads(self.$disk)
        }

        fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
            bun_sema::resolve::Host::io_pool(self.$disk)
        }
    };
}

macro_rules! delegate_runtime_config_parsers_to_disk {
    ($disk:ident) => {
        fn parse_runtime_package_json(
            &self,
            arena: &bun_sema::session::Arena,
            text: &[u8],
        ) -> Option<bun_sema::json::Json> {
            bun_sema::resolve::CodeHost::parse_runtime_package_json(self.$disk, arena, text)
        }

        fn parse_runtime_tsconfig(
            &self,
            arena: &bun_sema::session::Arena,
            text: &[u8],
        ) -> Option<bun_sema::json::Json> {
            bun_sema::resolve::CodeHost::parse_runtime_tsconfig(self.$disk, arena, text)
        }
    };
}

pub(crate) use delegate_host_services_to_disk;
pub(crate) use delegate_runtime_config_parsers_to_disk;
