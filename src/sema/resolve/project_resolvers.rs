use super::*;

#[cfg(test)]
mod tests;

pub struct ProjectResolvers<'h>(SmallMemo<usize, Resolver<'h>>);

impl<'h> ProjectResolvers<'h> {
    pub fn new() -> ProjectResolvers<'h> {
        ProjectResolvers(SmallMemo {
            index_by_key: Default::default(),
            values: AppendVec::new(),
        })
    }

    pub fn resolver_for<'a>(
        &'a self,
        program: &'a Resolver<'h>,
        options: &'h Options,
    ) -> &'a Resolver<'h> {
        debug_assert!(program.redirect == 0);
        if std::ptr::eq(options, program.options) {
            return program;
        }
        let key = std::ptr::from_ref(options).addr();
        let mut places = self.0.index_by_key.lock();
        if let Some(&at) = places.get(&key) {
            return self.0.values.get(at);
        }
        let shares_caches =
            program.options.referenced_outputs.is_empty() && options.referenced_outputs.is_empty();
        let first_redirect = 1 + program.options.referenced_options.len() as u32;
        let at = self.0.values.push(Resolver {
            session: program.session,
            host: program.host,
            options,
            caches: match shares_caches {
                true => std::sync::Arc::clone(&program.caches),
                false => std::sync::Arc::new(Caches::new(false)),
            },
            ambiguous_roots: bun_threading::Guarded::new(Vec::new_in(program.session)),
            links: bun_threading::Guarded::new(Vec::new_in(program.session)),
            redirected: Vec::new(),
            redirect: first_redirect + places.len() as u32,
            code: None,
        });
        places.insert(key, at);
        self.0.values.get(at)
    }

    pub fn add_links_to(&self, program: &Resolver<'h>) {
        let mut links = program.links.lock();
        for at in 0..self.0.values.len() {
            links.extend(self.0.values.get(at).links.lock().iter().copied());
        }
    }
}

impl Default for ProjectResolvers<'_> {
    fn default() -> Self {
        Self::new()
    }
}
