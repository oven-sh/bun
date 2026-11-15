bun_opaque::sealed_handle! {
    /// Opaque representation of a JavaScript source provider
    pub struct SourceProvider;
}

// SAFETY: only C++ makes one, from the ref that it stores in `ZigStackTrace::referenced_source_provider`.
bun_opaque::owned_handle! {
    pub(crate) struct SourceProviderRef(SourceProvider) => unsafe crate::cpp::JSC__SourceProvider__deref;
}
