macro_rules! forward_to_disk {
    ($services:ident, $disk:ident, $(
        fn $name:ident $(<$tree:lifetime>)? (&self $(, $argument:ident: $type:ty)* $(,)?)
            $(-> $answer:ty)?;
    )*) => {
        $(fn $name $(<$tree>)? (&self $(, $argument: $type)*) $(-> $answer)? {
            bun_sema::resolve::$services::$name(self.$disk $(, $argument)*)
        })*
    };
}

macro_rules! delegate_host_services_to_disk {
    ($disk:ident) => {
        fn take_unreadable(&self) -> Vec<Vec<u8>> {
            let mut paths = std::mem::take(&mut *self.unreadable.lock());
            paths.extend(bun_sema::resolve::Host::take_unreadable(self.$disk));
            paths
        }

        fn realpath(&self, path: &[u8]) -> Vec<u8> {
            match crate::load::is_host_path(path) {
                true => path.to_vec(),
                false => bun_sema::resolve::Host::realpath(self.$disk, path),
            }
        }

        fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
            let (mut names, directories) = bun_sema::resolve::Host::entries(self, path);
            names.extend(directories);
            names
        }

        crate::load::disk_delegation::forward_to_disk! { Host, $disk,
            fn origin(&self, path: &[u8]) -> usize;
            fn is_case_sensitive(&self) -> bool;
            fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>>;
            fn parse<'tree>(
                &self,
                arena: &'tree bun_sema::session::Arena,
                path: &[u8],
                text: &[u8],
                atoms: &bun_sema::atom::Interner<'tree>,
                options: bun_sema::resolve::ParseOptions,
            ) -> bun_sema::hir::File<'tree>;
            fn parse_top_level<'tree>(
                &self,
                arena: &'tree bun_sema::session::Arena,
                path: &[u8],
                text: &[u8],
                atoms: &bun_sema::atom::Interner<'tree>,
                options: bun_sema::resolve::ParseOptions,
            ) -> Option<bun_sema::hir::File<'tree>>;
            fn parse_package_json(
                &self,
                arena: &bun_sema::session::Arena,
                text: &[u8],
            ) -> Option<bun_sema::json::Json>;
            fn extended_config(&self, path: &[u8]) -> Option<bun_sema::resolve::CachedConfig>;
            fn cache_extended_config(
                &self,
                path: &[u8],
                parsed: &dyn Fn() -> bun_sema::resolve::CachedConfig,
            );
            fn shared_paths(
                &self,
                paths: std::sync::Arc<bun_sema::resolve::Paths>,
            ) -> std::sync::Arc<bun_sema::resolve::Paths>;
            fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync));
            fn parallel_while(
                &self,
                count: usize,
                work: &(dyn Fn(usize) + Sync),
                meanwhile: &mut dyn FnMut(),
            );
            fn run_regions_inline(&self, work: &mut dyn FnMut());
            fn is_single_threaded(&self) -> bool;
            fn helpers_now(&self) -> Option<usize>;
            fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync));
            fn loaded(&self);
            fn threads(&self) -> usize;
            fn io_pool(&self) -> Option<&bun_threading::ThreadPool>;
        }
    };
}

macro_rules! delegate_runtime_config_parsers_to_disk {
    ($disk:ident) => {
        crate::load::disk_delegation::forward_to_disk! { CodeHost, $disk,
            fn parse_runtime_package_json(
                &self,
                arena: &bun_sema::session::Arena,
                text: &[u8],
            ) -> Option<bun_sema::json::Json>;
            fn parse_runtime_tsconfig(
                &self,
                arena: &bun_sema::session::Arena,
                text: &[u8],
            ) -> Option<bun_sema::json::Json>;
        }
    };
}

pub(crate) use delegate_host_services_to_disk;
pub(crate) use delegate_runtime_config_parsers_to_disk;
pub(crate) use forward_to_disk;
