pub const GIT_FEATURE_THREADS: c_int = 1;
pub const GIT_FEATURE_HTTPS: c_int = 2;
pub const GIT_FEATURE_SSH: c_int = 4;
pub const GIT_FEATURE_NSEC: c_int = 8;
pub const git_feature_t = c_uint;
pub const GIT_OPT_GET_MWINDOW_SIZE: c_int = 0;
pub const GIT_OPT_SET_MWINDOW_SIZE: c_int = 1;
pub const GIT_OPT_GET_MWINDOW_MAPPED_LIMIT: c_int = 2;
pub const GIT_OPT_SET_MWINDOW_MAPPED_LIMIT: c_int = 3;
pub const GIT_OPT_GET_SEARCH_PATH: c_int = 4;
pub const GIT_OPT_SET_SEARCH_PATH: c_int = 5;
pub const GIT_OPT_SET_CACHE_OBJECT_LIMIT: c_int = 6;
pub const GIT_OPT_SET_CACHE_MAX_SIZE: c_int = 7;
pub const GIT_OPT_ENABLE_CACHING: c_int = 8;
pub const GIT_OPT_GET_CACHED_MEMORY: c_int = 9;
pub const GIT_OPT_GET_TEMPLATE_PATH: c_int = 10;
pub const GIT_OPT_SET_TEMPLATE_PATH: c_int = 11;
pub const GIT_OPT_SET_SSL_CERT_LOCATIONS: c_int = 12;
pub const GIT_OPT_SET_USER_AGENT: c_int = 13;
pub const GIT_OPT_ENABLE_STRICT_OBJECT_CREATION: c_int = 14;
pub const GIT_OPT_ENABLE_STRICT_SYMBOLIC_REF_CREATION: c_int = 15;
pub const GIT_OPT_SET_SSL_CIPHERS: c_int = 16;
pub const GIT_OPT_GET_USER_AGENT: c_int = 17;
pub const GIT_OPT_ENABLE_OFS_DELTA: c_int = 18;
pub const GIT_OPT_ENABLE_FSYNC_GITDIR: c_int = 19;
pub const GIT_OPT_GET_WINDOWS_SHAREMODE: c_int = 20;
pub const GIT_OPT_SET_WINDOWS_SHAREMODE: c_int = 21;
pub const GIT_OPT_ENABLE_STRICT_HASH_VERIFICATION: c_int = 22;
pub const GIT_OPT_SET_ALLOCATOR: c_int = 23;
pub const GIT_OPT_ENABLE_UNSAVED_INDEX_SAFETY: c_int = 24;
pub const GIT_OPT_GET_PACK_MAX_OBJECTS: c_int = 25;
pub const GIT_OPT_SET_PACK_MAX_OBJECTS: c_int = 26;
pub const GIT_OPT_DISABLE_PACK_KEEP_FILE_CHECKS: c_int = 27;
pub const GIT_OPT_ENABLE_HTTP_EXPECT_CONTINUE: c_int = 28;
pub const GIT_OPT_GET_MWINDOW_FILE_LIMIT: c_int = 29;
pub const GIT_OPT_SET_MWINDOW_FILE_LIMIT: c_int = 30;
pub const GIT_OPT_SET_ODB_PACKED_PRIORITY: c_int = 31;
pub const GIT_OPT_SET_ODB_LOOSE_PRIORITY: c_int = 32;
pub const GIT_OPT_GET_EXTENSIONS: c_int = 33;
pub const GIT_OPT_SET_EXTENSIONS: c_int = 34;
pub const git_libgit2_opt_t = c_uint;

pub const git_off_t = i64;
pub const git_time_t = i64;
pub const git_object_size_t = u64;
pub const git_buf = extern struct {
    ptr: [*c]u8,
    asize: usize,
    size: usize,
};
pub const struct_git_oid = extern struct {
    id: [20]u8,
};
pub const git_oid = struct_git_oid;
pub const struct_git_oid_shorten = opaque {};
pub const git_oid_shorten = struct_git_oid_shorten;
pub const GIT_OBJECT_ANY: c_int = -2;
pub const GIT_OBJECT_INVALID: c_int = -1;
pub const GIT_OBJECT_COMMIT: c_int = 1;
pub const GIT_OBJECT_TREE: c_int = 2;
pub const GIT_OBJECT_BLOB: c_int = 3;
pub const GIT_OBJECT_TAG: c_int = 4;
pub const GIT_OBJECT_OFS_DELTA: c_int = 6;
pub const GIT_OBJECT_REF_DELTA: c_int = 7;
pub const git_object_t = c_int;
pub const struct_git_odb = opaque {};
pub const git_odb = struct_git_odb;
pub const struct_git_odb_backend = opaque {};
pub const git_odb_backend = struct_git_odb_backend;
pub const struct_git_odb_object = opaque {};
pub const git_odb_object = struct_git_odb_object;
pub const git_odb_stream = struct_git_odb_stream;
pub const struct_git_odb_stream = extern struct {
    backend: *git_odb_backend,
    mode: c_uint,
    hash_ctx: *c_void,
    declared_size: git_object_size_t,
    received_bytes: git_object_size_t,
    read: ?fn ([*c]git_odb_stream, [*c]u8, usize) callconv(.C) c_int,
    write: ?fn ([*c]git_odb_stream, [*c]const u8, usize) callconv(.C) c_int,
    finalize_write: ?fn ([*c]git_odb_stream, [*c]const git_oid) callconv(.C) c_int,
    free: ?fn ([*c]git_odb_stream) callconv(.C) void,
};
pub const git_odb_writepack = struct_git_odb_writepack;
pub const struct_git_indexer_progress = extern struct {
    total_objects: c_uint,
    indexed_objects: c_uint,
    received_objects: c_uint,
    local_objects: c_uint,
    total_deltas: c_uint,
    indexed_deltas: c_uint,
    received_bytes: usize,
};
pub const git_indexer_progress = struct_git_indexer_progress;
pub const struct_git_odb_writepack = extern struct {
    backend: *git_odb_backend,
    append: ?fn ([*c]git_odb_writepack, *const c_void, usize, [*c]git_indexer_progress) callconv(.C) c_int,
    commit: ?fn ([*c]git_odb_writepack, [*c]git_indexer_progress) callconv(.C) c_int,
    free: ?fn ([*c]git_odb_writepack) callconv(.C) void,
};
pub const struct_git_midx_writer = opaque {};
pub const git_midx_writer = struct_git_midx_writer;
pub const struct_git_refdb = opaque {};
pub const git_refdb = struct_git_refdb;
pub const struct_git_refdb_backend = opaque {};
pub const git_refdb_backend = struct_git_refdb_backend;
pub const struct_git_commit_graph = opaque {};
pub const git_commit_graph = struct_git_commit_graph;
pub const struct_git_commit_graph_writer = opaque {};
pub const git_commit_graph_writer = struct_git_commit_graph_writer;
pub const struct_git_repository = opaque {};
pub const git_repository = struct_git_repository;
pub const struct_git_worktree = opaque {};
pub const git_worktree = struct_git_worktree;
pub const struct_git_object = opaque {};
pub const git_object = struct_git_object;
pub const struct_git_revwalk = opaque {};
pub const git_revwalk = struct_git_revwalk;
pub const struct_git_tag = opaque {};
pub const git_tag = struct_git_tag;
pub const struct_git_blob = opaque {};
pub const git_blob = struct_git_blob;
pub const struct_git_commit = opaque {};
pub const git_commit = struct_git_commit;
pub const struct_git_tree_entry = opaque {};
pub const git_tree_entry = struct_git_tree_entry;
pub const struct_git_tree = opaque {};
pub const git_tree = struct_git_tree;
pub const struct_git_treebuilder = opaque {};
pub const git_treebuilder = struct_git_treebuilder;
pub const struct_git_index = opaque {};
pub const git_index = struct_git_index;
pub const struct_git_index_iterator = opaque {};
pub const git_index_iterator = struct_git_index_iterator;
pub const struct_git_index_conflict_iterator = opaque {};
pub const git_index_conflict_iterator = struct_git_index_conflict_iterator;
pub const struct_git_config = opaque {};
pub const git_config = struct_git_config;
pub const struct_git_config_backend = opaque {};
pub const git_config_backend = struct_git_config_backend;
pub const struct_git_reflog_entry = opaque {};
pub const git_reflog_entry = struct_git_reflog_entry;
pub const struct_git_reflog = opaque {};
pub const git_reflog = struct_git_reflog;
pub const struct_git_note = opaque {};
pub const git_note = struct_git_note;
pub const struct_git_packbuilder = opaque {};
pub const git_packbuilder = struct_git_packbuilder;
pub const struct_git_time = extern struct {
    time: git_time_t,
    offset: c_int,
    sign: u8,
};
pub const git_time = struct_git_time;
pub const struct_git_signature = extern struct {
    name: [*c]u8,
    email: [*c]u8,
    when: git_time,
};
pub const git_signature = struct_git_signature;
pub const struct_git_reference = opaque {};
pub const git_reference = struct_git_reference;
pub const struct_git_reference_iterator = opaque {};
pub const git_reference_iterator = struct_git_reference_iterator;
pub const struct_git_transaction = opaque {};
pub const git_transaction = struct_git_transaction;
pub const struct_git_annotated_commit = opaque {};
pub const git_annotated_commit = struct_git_annotated_commit;
pub const struct_git_status_list = opaque {};
pub const git_status_list = struct_git_status_list;
pub const struct_git_rebase = opaque {};
pub const git_rebase = struct_git_rebase;
pub const GIT_REFERENCE_INVALID: c_int = 0;
pub const GIT_REFERENCE_DIRECT: c_int = 1;
pub const GIT_REFERENCE_SYMBOLIC: c_int = 2;
pub const GIT_REFERENCE_ALL: c_int = 3;
pub const git_reference_t = c_uint;
pub const GIT_BRANCH_LOCAL: c_int = 1;
pub const GIT_BRANCH_REMOTE: c_int = 2;
pub const GIT_BRANCH_ALL: c_int = 3;
pub const git_branch_t = c_uint;
pub const GIT_FILEMODE_UNREADABLE: c_int = 0;
pub const GIT_FILEMODE_TREE: c_int = 16384;
pub const GIT_FILEMODE_BLOB: c_int = 33188;
pub const GIT_FILEMODE_BLOB_EXECUTABLE: c_int = 33261;
pub const GIT_FILEMODE_LINK: c_int = 40960;
pub const GIT_FILEMODE_COMMIT: c_int = 57344;
pub const git_filemode_t = c_uint;
pub const struct_git_refspec = opaque {};
pub const git_refspec = struct_git_refspec;
pub const struct_git_remote = opaque {};
pub const git_remote = struct_git_remote;
pub const struct_git_transport = opaque {};
pub const git_transport = struct_git_transport;
pub const struct_git_push = opaque {};
pub const git_push = struct_git_push;
pub const struct_git_remote_head = extern struct {
    local: c_int,
    oid: git_oid,
    loid: git_oid,
    name: [*c]u8,
    symref_target: [*c]u8,
};
pub const git_remote_head = struct_git_remote_head;
pub const git_transport_message_cb = ?fn ([*c]const u8, c_int, *c_void) callconv(.C) c_int;
pub const GIT_REMOTE_COMPLETION_DOWNLOAD: c_int = 0;
pub const GIT_REMOTE_COMPLETION_INDEXING: c_int = 1;
pub const GIT_REMOTE_COMPLETION_ERROR: c_int = 2;
pub const enum_git_remote_completion_t = c_uint;
pub const git_remote_completion_t = enum_git_remote_completion_t;
pub const struct_git_credential = extern struct {
    credtype: git_credential_t,
    free: ?fn ([*c]git_credential) callconv(.C) void,
};
pub const git_credential = struct_git_credential;
pub const git_credential_acquire_cb = ?fn ([*c][*c]git_credential, [*c]const u8, [*c]const u8, c_uint, *c_void) callconv(.C) c_int;
pub const GIT_CERT_NONE: c_int = 0;
pub const GIT_CERT_X509: c_int = 1;
pub const GIT_CERT_HOSTKEY_LIBSSH2: c_int = 2;
pub const GIT_CERT_STRARRAY: c_int = 3;
pub const enum_git_cert_t = c_uint;
pub const git_cert_t = enum_git_cert_t;
pub const struct_git_cert = extern struct {
    cert_type: git_cert_t,
};
pub const git_cert = struct_git_cert;
pub const git_transport_certificate_check_cb = ?fn ([*c]git_cert, c_int, [*c]const u8, *c_void) callconv(.C) c_int;
pub const git_indexer_progress_cb = ?fn ([*c]const git_indexer_progress, *c_void) callconv(.C) c_int;
pub const git_packbuilder_progress = ?fn (c_int, u32, u32, *c_void) callconv(.C) c_int;
pub const git_push_transfer_progress_cb = ?fn (c_uint, c_uint, usize, *c_void) callconv(.C) c_int;
pub const git_push_update_reference_cb = ?fn ([*c]const u8, [*c]const u8, *c_void) callconv(.C) c_int;
pub const git_push_negotiation = ?fn ([*c][*c]const git_push_update, usize, *c_void) callconv(.C) c_int;
pub const git_transport_cb = ?fn ([*c]*git_transport, *git_remote, *c_void) callconv(.C) c_int;
pub const git_remote_ready_cb = ?fn (*git_remote, c_int, *c_void) callconv(.C) c_int;
pub const git_url_resolve_cb = ?fn ([*c]git_buf, [*c]const u8, c_int, *c_void) callconv(.C) c_int;
pub const struct_git_remote_callbacks = extern struct {
    version: c_uint,
    sideband_progress: git_transport_message_cb,
    completion: ?fn (git_remote_completion_t, *c_void) callconv(.C) c_int,
    credentials: git_credential_acquire_cb,
    certificate_check: git_transport_certificate_check_cb,
    transfer_progress: git_indexer_progress_cb,
    update_tips: ?fn ([*c]const u8, [*c]const git_oid, [*c]const git_oid, *c_void) callconv(.C) c_int,
    pack_progress: git_packbuilder_progress,
    push_transfer_progress: git_push_transfer_progress_cb,
    push_update_reference: git_push_update_reference_cb,
    push_negotiation: git_push_negotiation,
    transport: git_transport_cb,
    remote_ready: git_remote_ready_cb,
    payload: *c_void,
    resolve_url: git_url_resolve_cb,
};
pub const git_remote_callbacks = struct_git_remote_callbacks;
pub const struct_git_submodule = opaque {};
pub const git_submodule = struct_git_submodule;
pub const GIT_SUBMODULE_UPDATE_CHECKOUT: c_int = 1;
pub const GIT_SUBMODULE_UPDATE_REBASE: c_int = 2;
pub const GIT_SUBMODULE_UPDATE_MERGE: c_int = 3;
pub const GIT_SUBMODULE_UPDATE_NONE: c_int = 4;
pub const GIT_SUBMODULE_UPDATE_DEFAULT: c_int = 0;
pub const git_submodule_update_t = c_uint;
pub const GIT_SUBMODULE_IGNORE_UNSPECIFIED: c_int = -1;
pub const GIT_SUBMODULE_IGNORE_NONE: c_int = 1;
pub const GIT_SUBMODULE_IGNORE_UNTRACKED: c_int = 2;
pub const GIT_SUBMODULE_IGNORE_DIRTY: c_int = 3;
pub const GIT_SUBMODULE_IGNORE_ALL: c_int = 4;
pub const git_submodule_ignore_t = c_int;
pub const GIT_SUBMODULE_RECURSE_NO: c_int = 0;
pub const GIT_SUBMODULE_RECURSE_YES: c_int = 1;
pub const GIT_SUBMODULE_RECURSE_ONDEMAND: c_int = 2;
pub const git_submodule_recurse_t = c_uint;
pub const git_writestream = struct_git_writestream;
pub const struct_git_writestream = extern struct {
    write: ?fn ([*c]git_writestream, [*c]const u8, usize) callconv(.C) c_int,
    close: ?fn ([*c]git_writestream) callconv(.C) c_int,
    free: ?fn ([*c]git_writestream) callconv(.C) void,
};
pub const struct_git_mailmap = opaque {};
pub const git_mailmap = struct_git_mailmap;
pub const GIT_REPOSITORY_OPEN_NO_SEARCH: c_int = 1;
pub const GIT_REPOSITORY_OPEN_CROSS_FS: c_int = 2;
pub const GIT_REPOSITORY_OPEN_BARE: c_int = 4;
pub const GIT_REPOSITORY_OPEN_NO_DOTGIT: c_int = 8;
pub const GIT_REPOSITORY_OPEN_FROM_ENV: c_int = 16;
pub const git_repository_open_flag_t = c_uint;
pub const GIT_REPOSITORY_INIT_BARE: c_int = 1;
pub const GIT_REPOSITORY_INIT_NO_REINIT: c_int = 2;
pub const GIT_REPOSITORY_INIT_NO_DOTGIT_DIR: c_int = 4;
pub const GIT_REPOSITORY_INIT_MKDIR: c_int = 8;
pub const GIT_REPOSITORY_INIT_MKPATH: c_int = 16;
pub const GIT_REPOSITORY_INIT_EXTERNAL_TEMPLATE: c_int = 32;
pub const GIT_REPOSITORY_INIT_RELATIVE_GITLINK: c_int = 64;
pub const git_repository_init_flag_t = c_uint;
pub const GIT_REPOSITORY_INIT_SHARED_UMASK: c_int = 0;
pub const GIT_REPOSITORY_INIT_SHARED_GROUP: c_int = 1533;
pub const GIT_REPOSITORY_INIT_SHARED_ALL: c_int = 1535;
pub const git_repository_init_mode_t = c_uint;
pub const git_repository_init_options = extern struct {
    version: c_uint,
    flags: u32,
    mode: u32,
    workdir_path: [*c]const u8,
    description: [*c]const u8,
    template_path: [*c]const u8,
    initial_head: [*c]const u8,
    origin_url: [*c]const u8,
};
pub const GIT_REPOSITORY_ITEM_GITDIR: c_int = 0;
pub const GIT_REPOSITORY_ITEM_WORKDIR: c_int = 1;
pub const GIT_REPOSITORY_ITEM_COMMONDIR: c_int = 2;
pub const GIT_REPOSITORY_ITEM_INDEX: c_int = 3;
pub const GIT_REPOSITORY_ITEM_OBJECTS: c_int = 4;
pub const GIT_REPOSITORY_ITEM_REFS: c_int = 5;
pub const GIT_REPOSITORY_ITEM_PACKED_REFS: c_int = 6;
pub const GIT_REPOSITORY_ITEM_REMOTES: c_int = 7;
pub const GIT_REPOSITORY_ITEM_CONFIG: c_int = 8;
pub const GIT_REPOSITORY_ITEM_INFO: c_int = 9;
pub const GIT_REPOSITORY_ITEM_HOOKS: c_int = 10;
pub const GIT_REPOSITORY_ITEM_LOGS: c_int = 11;
pub const GIT_REPOSITORY_ITEM_MODULES: c_int = 12;
pub const GIT_REPOSITORY_ITEM_WORKTREES: c_int = 13;
pub const GIT_REPOSITORY_ITEM__LAST: c_int = 14;
pub const git_repository_item_t = c_uint;
pub const git_repository_fetchhead_foreach_cb = ?fn ([*c]const u8, [*c]const u8, [*c]const git_oid, c_uint, *c_void) callconv(.C) c_int;
pub const git_repository_mergehead_foreach_cb = ?fn ([*c]const git_oid, *c_void) callconv(.C) c_int;
pub const GIT_REPOSITORY_STATE_NONE: c_int = 0;
pub const GIT_REPOSITORY_STATE_MERGE: c_int = 1;
pub const GIT_REPOSITORY_STATE_REVERT: c_int = 2;
pub const GIT_REPOSITORY_STATE_REVERT_SEQUENCE: c_int = 3;
pub const GIT_REPOSITORY_STATE_CHERRYPICK: c_int = 4;
pub const GIT_REPOSITORY_STATE_CHERRYPICK_SEQUENCE: c_int = 5;
pub const GIT_REPOSITORY_STATE_BISECT: c_int = 6;
pub const GIT_REPOSITORY_STATE_REBASE: c_int = 7;
pub const GIT_REPOSITORY_STATE_REBASE_INTERACTIVE: c_int = 8;
pub const GIT_REPOSITORY_STATE_REBASE_MERGE: c_int = 9;
pub const GIT_REPOSITORY_STATE_APPLY_MAILBOX: c_int = 10;
pub const GIT_REPOSITORY_STATE_APPLY_MAILBOX_OR_REBASE: c_int = 11;
pub const git_repository_state_t = c_uint;
pub const git_treebuilder_filter_cb = ?fn (*const git_tree_entry, *c_void) callconv(.C) c_int;
pub const git_treewalk_cb = ?fn ([*c]const u8, *const git_tree_entry, *c_void) callconv(.C) c_int;
pub const GIT_TREEWALK_PRE: c_int = 0;
pub const GIT_TREEWALK_POST: c_int = 1;
pub const git_treewalk_mode = c_uint;
pub const GIT_TREE_UPDATE_UPSERT: c_int = 0;
pub const GIT_TREE_UPDATE_REMOVE: c_int = 1;
pub const git_tree_update_t = c_uint;
pub const git_tree_update = extern struct {
    action: git_tree_update_t,
    id: git_oid,
    filemode: git_filemode_t,
    path: [*c]const u8,
};
pub const struct_git_strarray = extern struct {
    strings: [*c][*c]u8,
    count: usize,
};
pub const git_strarray = struct_git_strarray;
pub const git_reference_foreach_cb = ?fn (*git_reference, *c_void) callconv(.C) c_int;
pub const git_reference_foreach_name_cb = ?fn ([*c]const u8, *c_void) callconv(.C) c_int;
pub const GIT_REFERENCE_FORMAT_NORMAL: c_int = 0;
pub const GIT_REFERENCE_FORMAT_ALLOW_ONELEVEL: c_int = 1;
pub const GIT_REFERENCE_FORMAT_REFSPEC_PATTERN: c_int = 2;
pub const GIT_REFERENCE_FORMAT_REFSPEC_SHORTHAND: c_int = 4;
pub const git_reference_format_t = c_uint;
pub const GIT_DIFF_NORMAL: c_int = 0;
pub const GIT_DIFF_REVERSE: c_int = 1;
pub const GIT_DIFF_INCLUDE_IGNORED: c_int = 2;
pub const GIT_DIFF_RECURSE_IGNORED_DIRS: c_int = 4;
pub const GIT_DIFF_INCLUDE_UNTRACKED: c_int = 8;
pub const GIT_DIFF_RECURSE_UNTRACKED_DIRS: c_int = 16;
pub const GIT_DIFF_INCLUDE_UNMODIFIED: c_int = 32;
pub const GIT_DIFF_INCLUDE_TYPECHANGE: c_int = 64;
pub const GIT_DIFF_INCLUDE_TYPECHANGE_TREES: c_int = 128;
pub const GIT_DIFF_IGNORE_FILEMODE: c_int = 256;
pub const GIT_DIFF_IGNORE_SUBMODULES: c_int = 512;
pub const GIT_DIFF_IGNORE_CASE: c_int = 1024;
pub const GIT_DIFF_INCLUDE_CASECHANGE: c_int = 2048;
pub const GIT_DIFF_DISABLE_PATHSPEC_MATCH: c_int = 4096;
pub const GIT_DIFF_SKIP_BINARY_CHECK: c_int = 8192;
pub const GIT_DIFF_ENABLE_FAST_UNTRACKED_DIRS: c_int = 16384;
pub const GIT_DIFF_UPDATE_INDEX: c_int = 32768;
pub const GIT_DIFF_INCLUDE_UNREADABLE: c_int = 65536;
pub const GIT_DIFF_INCLUDE_UNREADABLE_AS_UNTRACKED: c_int = 131072;
pub const GIT_DIFF_INDENT_HEURISTIC: c_int = 262144;
pub const GIT_DIFF_IGNORE_BLANK_LINES: c_int = 524288;
pub const GIT_DIFF_FORCE_TEXT: c_int = 1048576;
pub const GIT_DIFF_FORCE_BINARY: c_int = 2097152;
pub const GIT_DIFF_IGNORE_WHITESPACE: c_int = 4194304;
pub const GIT_DIFF_IGNORE_WHITESPACE_CHANGE: c_int = 8388608;
pub const GIT_DIFF_IGNORE_WHITESPACE_EOL: c_int = 16777216;
pub const GIT_DIFF_SHOW_UNTRACKED_CONTENT: c_int = 33554432;
pub const GIT_DIFF_SHOW_UNMODIFIED: c_int = 67108864;
pub const GIT_DIFF_PATIENCE: c_int = 268435456;
pub const GIT_DIFF_MINIMAL: c_int = 536870912;
pub const GIT_DIFF_SHOW_BINARY: c_int = 1073741824;
pub const git_diff_option_t = c_uint;
pub const struct_git_diff = opaque {};
pub const git_diff = struct_git_diff;
pub const GIT_DIFF_FLAG_BINARY: c_int = 1;
pub const GIT_DIFF_FLAG_NOT_BINARY: c_int = 2;
pub const GIT_DIFF_FLAG_VALID_ID: c_int = 4;
pub const GIT_DIFF_FLAG_EXISTS: c_int = 8;
pub const git_diff_flag_t = c_uint;
pub const GIT_DELTA_UNMODIFIED: c_int = 0;
pub const GIT_DELTA_ADDED: c_int = 1;
pub const GIT_DELTA_DELETED: c_int = 2;
pub const GIT_DELTA_MODIFIED: c_int = 3;
pub const GIT_DELTA_RENAMED: c_int = 4;
pub const GIT_DELTA_COPIED: c_int = 5;
pub const GIT_DELTA_IGNORED: c_int = 6;
pub const GIT_DELTA_UNTRACKED: c_int = 7;
pub const GIT_DELTA_TYPECHANGE: c_int = 8;
pub const GIT_DELTA_UNREADABLE: c_int = 9;
pub const GIT_DELTA_CONFLICTED: c_int = 10;
pub const git_delta_t = c_uint;
pub const git_diff_file = extern struct {
    id: git_oid,
    path: [*c]const u8,
    size: git_object_size_t,
    flags: u32,
    mode: u16,
    id_abbrev: u16,
};
pub const git_diff_delta = extern struct {
    status: git_delta_t,
    flags: u32,
    similarity: u16,
    nfiles: u16,
    old_file: git_diff_file,
    new_file: git_diff_file,
};
pub const git_diff_notify_cb = ?fn (*const git_diff, [*c]const git_diff_delta, [*c]const u8, *c_void) callconv(.C) c_int;
pub const git_diff_progress_cb = ?fn (*const git_diff, [*c]const u8, [*c]const u8, *c_void) callconv(.C) c_int;
pub const git_diff_options = extern struct {
    version: c_uint,
    flags: u32,
    ignore_submodules: git_submodule_ignore_t,
    pathspec: git_strarray,
    notify_cb: git_diff_notify_cb,
    progress_cb: git_diff_progress_cb,
    payload: *c_void,
    context_lines: u32,
    interhunk_lines: u32,
    id_abbrev: u16,
    max_size: git_off_t,
    old_prefix: [*c]const u8,
    new_prefix: [*c]const u8,
};
pub const git_diff_file_cb = ?fn ([*c]const git_diff_delta, f32, *c_void) callconv(.C) c_int;
pub const GIT_DIFF_BINARY_NONE: c_int = 0;
pub const GIT_DIFF_BINARY_LITERAL: c_int = 1;
pub const GIT_DIFF_BINARY_DELTA: c_int = 2;
pub const git_diff_binary_t = c_uint;
pub const git_diff_binary_file = extern struct {
    type: git_diff_binary_t,
    data: [*c]const u8,
    datalen: usize,
    inflatedlen: usize,
};
pub const git_diff_binary = extern struct {
    contains_data: c_uint,
    old_file: git_diff_binary_file,
    new_file: git_diff_binary_file,
};
pub const git_diff_binary_cb = ?fn ([*c]const git_diff_delta, [*c]const git_diff_binary, *c_void) callconv(.C) c_int;
pub const git_diff_hunk = extern struct {
    old_start: c_int,
    old_lines: c_int,
    new_start: c_int,
    new_lines: c_int,
    header_len: usize,
    header: [128]u8,
};
pub const git_diff_hunk_cb = ?fn ([*c]const git_diff_delta, [*c]const git_diff_hunk, *c_void) callconv(.C) c_int;
pub const GIT_DIFF_LINE_CONTEXT: c_int = 32;
pub const GIT_DIFF_LINE_ADDITION: c_int = 43;
pub const GIT_DIFF_LINE_DELETION: c_int = 45;
pub const GIT_DIFF_LINE_CONTEXT_EOFNL: c_int = 61;
pub const GIT_DIFF_LINE_ADD_EOFNL: c_int = 62;
pub const GIT_DIFF_LINE_DEL_EOFNL: c_int = 60;
pub const GIT_DIFF_LINE_FILE_HDR: c_int = 70;
pub const GIT_DIFF_LINE_HUNK_HDR: c_int = 72;
pub const GIT_DIFF_LINE_BINARY: c_int = 66;
pub const git_diff_line_t = c_uint;
pub const git_diff_line = extern struct {
    origin: u8,
    old_lineno: c_int,
    new_lineno: c_int,
    num_lines: c_int,
    content_len: usize,
    content_offset: git_off_t,
    content: [*c]const u8,
};
pub const git_diff_line_cb = ?fn ([*c]const git_diff_delta, [*c]const git_diff_hunk, [*c]const git_diff_line, *c_void) callconv(.C) c_int;
pub const GIT_DIFF_FIND_BY_CONFIG: c_int = 0;
pub const GIT_DIFF_FIND_RENAMES: c_int = 1;
pub const GIT_DIFF_FIND_RENAMES_FROM_REWRITES: c_int = 2;
pub const GIT_DIFF_FIND_COPIES: c_int = 4;
pub const GIT_DIFF_FIND_COPIES_FROM_UNMODIFIED: c_int = 8;
pub const GIT_DIFF_FIND_REWRITES: c_int = 16;
pub const GIT_DIFF_BREAK_REWRITES: c_int = 32;
pub const GIT_DIFF_FIND_AND_BREAK_REWRITES: c_int = 48;
pub const GIT_DIFF_FIND_FOR_UNTRACKED: c_int = 64;
pub const GIT_DIFF_FIND_ALL: c_int = 255;
pub const GIT_DIFF_FIND_IGNORE_LEADING_WHITESPACE: c_int = 0;
pub const GIT_DIFF_FIND_IGNORE_WHITESPACE: c_int = 4096;
pub const GIT_DIFF_FIND_DONT_IGNORE_WHITESPACE: c_int = 8192;
pub const GIT_DIFF_FIND_EXACT_MATCH_ONLY: c_int = 16384;
pub const GIT_DIFF_BREAK_REWRITES_FOR_RENAMES_ONLY: c_int = 32768;
pub const GIT_DIFF_FIND_REMOVE_UNMODIFIED: c_int = 65536;
pub const git_diff_find_t = c_uint;
pub const git_diff_similarity_metric = extern struct {
    file_signature: ?fn ([*c]*c_void, [*c]const git_diff_file, [*c]const u8, *c_void) callconv(.C) c_int,
    buffer_signature: ?fn ([*c]*c_void, [*c]const git_diff_file, [*c]const u8, usize, *c_void) callconv(.C) c_int,
    free_signature: ?fn (*c_void, *c_void) callconv(.C) void,
    similarity: ?fn ([*c]c_int, *c_void, *c_void, *c_void) callconv(.C) c_int,
    payload: *c_void,
};
pub const git_diff_find_options = extern struct {
    version: c_uint,
    flags: u32,
    rename_threshold: u16,
    rename_from_rewrite_threshold: u16,
    copy_threshold: u16,
    break_rewrite_threshold: u16,
    rename_limit: usize,
    metric: [*c]git_diff_similarity_metric,
};
pub const GIT_DIFF_FORMAT_PATCH: c_int = 1;
pub const GIT_DIFF_FORMAT_PATCH_HEADER: c_int = 2;
pub const GIT_DIFF_FORMAT_RAW: c_int = 3;
pub const GIT_DIFF_FORMAT_NAME_ONLY: c_int = 4;
pub const GIT_DIFF_FORMAT_NAME_STATUS: c_int = 5;
pub const GIT_DIFF_FORMAT_PATCH_ID: c_int = 6;
pub const git_diff_format_t = c_uint;
pub const struct_git_diff_stats = opaque {};
pub const git_diff_stats = struct_git_diff_stats;
pub const GIT_DIFF_STATS_NONE: c_int = 0;
pub const GIT_DIFF_STATS_FULL: c_int = 1;
pub const GIT_DIFF_STATS_SHORT: c_int = 2;
pub const GIT_DIFF_STATS_NUMBER: c_int = 4;
pub const GIT_DIFF_STATS_INCLUDE_SUMMARY: c_int = 8;
pub const git_diff_stats_format_t = c_uint;
pub const struct_git_diff_patchid_options = extern struct {
    version: c_uint,
};
pub const git_diff_patchid_options = struct_git_diff_patchid_options;
pub const git_apply_delta_cb = ?fn ([*c]const git_diff_delta, *c_void) callconv(.C) c_int;
pub const git_apply_hunk_cb = ?fn ([*c]const git_diff_hunk, *c_void) callconv(.C) c_int;
pub const GIT_APPLY_CHECK: c_int = 1;
pub const git_apply_flags_t = c_uint;
pub const git_apply_options = extern struct {
    version: c_uint,
    delta_cb: git_apply_delta_cb,
    hunk_cb: git_apply_hunk_cb,
    payload: *c_void,
    flags: c_uint,
};
pub const GIT_APPLY_LOCATION_WORKDIR: c_int = 0;
pub const GIT_APPLY_LOCATION_INDEX: c_int = 1;
pub const GIT_APPLY_LOCATION_BOTH: c_int = 2;
pub const git_apply_location_t = c_uint;
pub const GIT_ATTR_VALUE_UNSPECIFIED: c_int = 0;
pub const GIT_ATTR_VALUE_TRUE: c_int = 1;
pub const GIT_ATTR_VALUE_FALSE: c_int = 2;
pub const GIT_ATTR_VALUE_STRING: c_int = 3;
pub const git_attr_value_t = c_uint;
pub const git_attr_options = extern struct {
    version: c_uint,
    flags: c_uint,
    commit_id: [*c]git_oid,
    attr_commit_id: git_oid,
};
pub const git_attr_foreach_cb = ?fn ([*c]const u8, [*c]const u8, *c_void) callconv(.C) c_int;
pub const GIT_BLOB_FILTER_CHECK_FOR_BINARY: c_int = 1;
pub const GIT_BLOB_FILTER_NO_SYSTEM_ATTRIBUTES: c_int = 2;
pub const GIT_BLOB_FILTER_ATTRIBUTES_FROM_HEAD: c_int = 4;
pub const GIT_BLOB_FILTER_ATTRIBUTES_FROM_COMMIT: c_int = 8;
pub const git_blob_filter_flag_t = c_uint;
pub const git_blob_filter_options = extern struct {
    version: c_int,
    flags: u32,
    commit_id: [*c]git_oid,
    attr_commit_id: git_oid,
};
pub const GIT_BLAME_NORMAL: c_int = 0;
pub const GIT_BLAME_TRACK_COPIES_SAME_FILE: c_int = 1;
pub const GIT_BLAME_TRACK_COPIES_SAME_COMMIT_MOVES: c_int = 2;
pub const GIT_BLAME_TRACK_COPIES_SAME_COMMIT_COPIES: c_int = 4;
pub const GIT_BLAME_TRACK_COPIES_ANY_COMMIT_COPIES: c_int = 8;
pub const GIT_BLAME_FIRST_PARENT: c_int = 16;
pub const GIT_BLAME_USE_MAILMAP: c_int = 32;
pub const GIT_BLAME_IGNORE_WHITESPACE: c_int = 64;
pub const git_blame_flag_t = c_uint;
pub const struct_git_blame_options = extern struct {
    version: c_uint,
    flags: u32,
    min_match_characters: u16,
    newest_commit: git_oid,
    oldest_commit: git_oid,
    min_line: usize,
    max_line: usize,
};
pub const git_blame_options = struct_git_blame_options;
pub const struct_git_blame_hunk = extern struct {
    lines_in_hunk: usize,
    final_commit_id: git_oid,
    final_start_line_number: usize,
    final_signature: [*c]git_signature,
    orig_commit_id: git_oid,
    orig_path: [*c]const u8,
    orig_start_line_number: usize,
    orig_signature: [*c]git_signature,
    boundary: u8,
};
pub const git_blame_hunk = struct_git_blame_hunk;
pub const struct_git_blame = opaque {};
pub const git_blame = struct_git_blame;
pub const struct_git_branch_iterator = opaque {};
pub const git_branch_iterator = struct_git_branch_iterator;
pub const GIT_CERT_SSH_MD5: c_int = 1;
pub const GIT_CERT_SSH_SHA1: c_int = 2;
pub const GIT_CERT_SSH_SHA256: c_int = 4;
pub const GIT_CERT_SSH_RAW: c_int = 8;
pub const git_cert_ssh_t = c_uint;
pub const GIT_CERT_SSH_RAW_TYPE_UNKNOWN: c_int = 0;
pub const GIT_CERT_SSH_RAW_TYPE_RSA: c_int = 1;
pub const GIT_CERT_SSH_RAW_TYPE_DSS: c_int = 2;
pub const GIT_CERT_SSH_RAW_TYPE_KEY_ECDSA_256: c_int = 3;
pub const GIT_CERT_SSH_RAW_TYPE_KEY_ECDSA_384: c_int = 4;
pub const GIT_CERT_SSH_RAW_TYPE_KEY_ECDSA_521: c_int = 5;
pub const GIT_CERT_SSH_RAW_TYPE_KEY_ED25519: c_int = 6;
pub const git_cert_ssh_raw_type_t = c_uint;
pub const git_cert_hostkey = extern struct {
    parent: git_cert,
    type: git_cert_ssh_t,
    hash_md5: [16]u8,
    hash_sha1: [20]u8,
    hash_sha256: [32]u8,
    raw_type: git_cert_ssh_raw_type_t,
    hostkey: [*c]const u8,
    hostkey_len: usize,
};
pub const git_cert_x509 = extern struct {
    parent: git_cert,
    data: *c_void,
    len: usize,
};
pub const GIT_CHECKOUT_NONE: c_int = 0;
pub const GIT_CHECKOUT_SAFE: c_int = 1;
pub const GIT_CHECKOUT_FORCE: c_int = 2;
pub const GIT_CHECKOUT_RECREATE_MISSING: c_int = 4;
pub const GIT_CHECKOUT_ALLOW_CONFLICTS: c_int = 16;
pub const GIT_CHECKOUT_REMOVE_UNTRACKED: c_int = 32;
pub const GIT_CHECKOUT_REMOVE_IGNORED: c_int = 64;
pub const GIT_CHECKOUT_UPDATE_ONLY: c_int = 128;
pub const GIT_CHECKOUT_DONT_UPDATE_INDEX: c_int = 256;
pub const GIT_CHECKOUT_NO_REFRESH: c_int = 512;
pub const GIT_CHECKOUT_SKIP_UNMERGED: c_int = 1024;
pub const GIT_CHECKOUT_USE_OURS: c_int = 2048;
pub const GIT_CHECKOUT_USE_THEIRS: c_int = 4096;
pub const GIT_CHECKOUT_DISABLE_PATHSPEC_MATCH: c_int = 8192;
pub const GIT_CHECKOUT_SKIP_LOCKED_DIRECTORIES: c_int = 262144;
pub const GIT_CHECKOUT_DONT_OVERWRITE_IGNORED: c_int = 524288;
pub const GIT_CHECKOUT_CONFLICT_STYLE_MERGE: c_int = 1048576;
pub const GIT_CHECKOUT_CONFLICT_STYLE_DIFF3: c_int = 2097152;
pub const GIT_CHECKOUT_DONT_REMOVE_EXISTING: c_int = 4194304;
pub const GIT_CHECKOUT_DONT_WRITE_INDEX: c_int = 8388608;
pub const GIT_CHECKOUT_DRY_RUN: c_int = 16777216;
pub const GIT_CHECKOUT_UPDATE_SUBMODULES: c_int = 65536;
pub const GIT_CHECKOUT_UPDATE_SUBMODULES_IF_CHANGED: c_int = 131072;
pub const git_checkout_strategy_t = c_uint;
pub const GIT_CHECKOUT_NOTIFY_NONE: c_int = 0;
pub const GIT_CHECKOUT_NOTIFY_CONFLICT: c_int = 1;
pub const GIT_CHECKOUT_NOTIFY_DIRTY: c_int = 2;
pub const GIT_CHECKOUT_NOTIFY_UPDATED: c_int = 4;
pub const GIT_CHECKOUT_NOTIFY_UNTRACKED: c_int = 8;
pub const GIT_CHECKOUT_NOTIFY_IGNORED: c_int = 16;
pub const GIT_CHECKOUT_NOTIFY_ALL: c_int = 65535;
pub const git_checkout_notify_t = c_uint;
pub const git_checkout_perfdata = extern struct {
    mkdir_calls: usize,
    stat_calls: usize,
    chmod_calls: usize,
};
pub const git_checkout_notify_cb = ?fn (git_checkout_notify_t, [*c]const u8, [*c]const git_diff_file, [*c]const git_diff_file, [*c]const git_diff_file, *c_void) callconv(.C) c_int;
pub const git_checkout_progress_cb = ?fn ([*c]const u8, usize, usize, *c_void) callconv(.C) void;
pub const git_checkout_perfdata_cb = ?fn ([*c]const git_checkout_perfdata, *c_void) callconv(.C) void;
pub const struct_git_checkout_options = extern struct {
    version: c_uint,
    checkout_strategy: c_uint,
    disable_filters: c_int,
    dir_mode: c_uint,
    file_mode: c_uint,
    file_open_flags: c_int,
    notify_flags: c_uint,
    notify_cb: git_checkout_notify_cb,
    notify_payload: *c_void,
    progress_cb: git_checkout_progress_cb,
    progress_payload: *c_void,
    paths: git_strarray,
    baseline: *git_tree,
    baseline_index: *git_index,
    target_directory: [*c]const u8,
    ancestor_label: [*c]const u8,
    our_label: [*c]const u8,
    their_label: [*c]const u8,
    perfdata_cb: git_checkout_perfdata_cb,
    perfdata_payload: *c_void,
};
pub const git_checkout_options = struct_git_checkout_options;
pub const struct_git_oidarray = extern struct {
    ids: [*c]git_oid,
    count: usize,
};
pub const git_oidarray = struct_git_oidarray;
pub const struct_git_indexer = opaque {};
pub const git_indexer = struct_git_indexer;
pub const struct_git_indexer_options = extern struct {
    version: c_uint,
    progress_cb: git_indexer_progress_cb,
    progress_cb_payload: *c_void,
    verify: u8,
};
pub const git_indexer_options = struct_git_indexer_options;
pub const git_index_time = extern struct {
    seconds: i32,
    nanoseconds: u32,
};
pub const struct_git_index_entry = extern struct {
    ctime: git_index_time,
    mtime: git_index_time,
    dev: u32,
    ino: u32,
    mode: u32,
    uid: u32,
    gid: u32,
    file_size: u32,
    id: git_oid,
    flags: u16,
    flags_extended: u16,
    path: [*c]const u8,
};
pub const git_index_entry = struct_git_index_entry;
pub const GIT_INDEX_ENTRY_EXTENDED: c_int = 16384;
pub const GIT_INDEX_ENTRY_VALID: c_int = 32768;
pub const git_index_entry_flag_t = c_uint;
pub const GIT_INDEX_ENTRY_INTENT_TO_ADD: c_int = 8192;
pub const GIT_INDEX_ENTRY_SKIP_WORKTREE: c_int = 16384;
pub const GIT_INDEX_ENTRY_EXTENDED_FLAGS: c_int = 24576;
pub const GIT_INDEX_ENTRY_UPTODATE: c_int = 4;
pub const git_index_entry_extended_flag_t = c_uint;
pub const GIT_INDEX_CAPABILITY_IGNORE_CASE: c_int = 1;
pub const GIT_INDEX_CAPABILITY_NO_FILEMODE: c_int = 2;
pub const GIT_INDEX_CAPABILITY_NO_SYMLINKS: c_int = 4;
pub const GIT_INDEX_CAPABILITY_FROM_OWNER: c_int = -1;
pub const git_index_capability_t = c_int;
pub const git_index_matched_path_cb = ?fn ([*c]const u8, [*c]const u8, *c_void) callconv(.C) c_int;
pub const GIT_INDEX_ADD_DEFAULT: c_int = 0;
pub const GIT_INDEX_ADD_FORCE: c_int = 1;
pub const GIT_INDEX_ADD_DISABLE_PATHSPEC_MATCH: c_int = 2;
pub const GIT_INDEX_ADD_CHECK_PATHSPEC: c_int = 4;
pub const git_index_add_option_t = c_uint;
pub const GIT_INDEX_STAGE_ANY: c_int = -1;
pub const GIT_INDEX_STAGE_NORMAL: c_int = 0;
pub const GIT_INDEX_STAGE_ANCESTOR: c_int = 1;
pub const GIT_INDEX_STAGE_OURS: c_int = 2;
pub const GIT_INDEX_STAGE_THEIRS: c_int = 3;
pub const git_index_stage_t = c_int;
pub const git_merge_file_input = extern struct {
    version: c_uint,
    ptr: [*c]const u8,
    size: usize,
    path: [*c]const u8,
    mode: c_uint,
};
pub const GIT_MERGE_FIND_RENAMES: c_int = 1;
pub const GIT_MERGE_FAIL_ON_CONFLICT: c_int = 2;
pub const GIT_MERGE_SKIP_REUC: c_int = 4;
pub const GIT_MERGE_NO_RECURSIVE: c_int = 8;
pub const git_merge_flag_t = c_uint;
pub const GIT_MERGE_FILE_FAVOR_NORMAL: c_int = 0;
pub const GIT_MERGE_FILE_FAVOR_OURS: c_int = 1;
pub const GIT_MERGE_FILE_FAVOR_THEIRS: c_int = 2;
pub const GIT_MERGE_FILE_FAVOR_UNION: c_int = 3;
pub const git_merge_file_favor_t = c_uint;
pub const GIT_MERGE_FILE_DEFAULT: c_int = 0;
pub const GIT_MERGE_FILE_STYLE_MERGE: c_int = 1;
pub const GIT_MERGE_FILE_STYLE_DIFF3: c_int = 2;
pub const GIT_MERGE_FILE_SIMPLIFY_ALNUM: c_int = 4;
pub const GIT_MERGE_FILE_IGNORE_WHITESPACE: c_int = 8;
pub const GIT_MERGE_FILE_IGNORE_WHITESPACE_CHANGE: c_int = 16;
pub const GIT_MERGE_FILE_IGNORE_WHITESPACE_EOL: c_int = 32;
pub const GIT_MERGE_FILE_DIFF_PATIENCE: c_int = 64;
pub const GIT_MERGE_FILE_DIFF_MINIMAL: c_int = 128;
pub const git_merge_file_flag_t = c_uint;
pub const git_merge_file_options = extern struct {
    version: c_uint,
    ancestor_label: [*c]const u8,
    our_label: [*c]const u8,
    their_label: [*c]const u8,
    favor: git_merge_file_favor_t,
    flags: u32,
    marker_size: c_ushort,
};
pub const git_merge_file_result = extern struct {
    automergeable: c_uint,
    path: [*c]const u8,
    mode: c_uint,
    ptr: [*c]const u8,
    len: usize,
};
pub const git_merge_options = extern struct {
    version: c_uint,
    flags: u32,
    rename_threshold: c_uint,
    target_limit: c_uint,
    metric: [*c]git_diff_similarity_metric,
    recursion_limit: c_uint,
    default_driver: [*c]const u8,
    file_favor: git_merge_file_favor_t,
    file_flags: u32,
};
pub const GIT_MERGE_ANALYSIS_NONE: c_int = 0;
pub const GIT_MERGE_ANALYSIS_NORMAL: c_int = 1;
pub const GIT_MERGE_ANALYSIS_UP_TO_DATE: c_int = 2;
pub const GIT_MERGE_ANALYSIS_FASTFORWARD: c_int = 4;
pub const GIT_MERGE_ANALYSIS_UNBORN: c_int = 8;
pub const git_merge_analysis_t = c_uint;
pub const GIT_MERGE_PREFERENCE_NONE: c_int = 0;
pub const GIT_MERGE_PREFERENCE_NO_FASTFORWARD: c_int = 1;
pub const GIT_MERGE_PREFERENCE_FASTFORWARD_ONLY: c_int = 2;
pub const git_merge_preference_t = c_uint;
pub const git_cherrypick_options = extern struct {
    version: c_uint,
    mainline: c_uint,
    merge_opts: git_merge_options,
    checkout_opts: git_checkout_options,
};
pub const GIT_DIRECTION_FETCH: c_int = 0;
pub const GIT_DIRECTION_PUSH: c_int = 1;
pub const git_direction = c_uint;
pub const GIT_CREDENTIAL_USERPASS_PLAINTEXT: c_int = 1;
pub const GIT_CREDENTIAL_SSH_KEY: c_int = 2;
pub const GIT_CREDENTIAL_SSH_CUSTOM: c_int = 4;
pub const GIT_CREDENTIAL_DEFAULT: c_int = 8;
pub const GIT_CREDENTIAL_SSH_INTERACTIVE: c_int = 16;
pub const GIT_CREDENTIAL_USERNAME: c_int = 32;
pub const GIT_CREDENTIAL_SSH_MEMORY: c_int = 64;
pub const git_credential_t = c_uint;
pub const struct_git_credential_userpass_plaintext = extern struct {
    parent: git_credential,
    username: [*c]u8,
    password: [*c]u8,
};
pub const git_credential_userpass_plaintext = struct_git_credential_userpass_plaintext;
pub const struct_git_credential_username = extern struct {
    parent: git_credential,
    username: [1]u8,
};
pub const git_credential_username = struct_git_credential_username;
pub const git_credential_default = struct_git_credential;
pub const struct_git_credential_ssh_key = extern struct {
    parent: git_credential,
    username: [*c]u8,
    publickey: [*c]u8,
    privatekey: [*c]u8,
    passphrase: [*c]u8,
};
pub const git_credential_ssh_key = struct_git_credential_ssh_key;
pub const struct__LIBSSH2_USERAUTH_KBDINT_PROMPT = opaque {};
pub const LIBSSH2_USERAUTH_KBDINT_PROMPT = struct__LIBSSH2_USERAUTH_KBDINT_PROMPT;
pub const struct__LIBSSH2_USERAUTH_KBDINT_RESPONSE = opaque {};
pub const LIBSSH2_USERAUTH_KBDINT_RESPONSE = struct__LIBSSH2_USERAUTH_KBDINT_RESPONSE;
pub const git_credential_ssh_interactive_cb = ?fn ([*c]const u8, c_int, [*c]const u8, c_int, c_int, *const LIBSSH2_USERAUTH_KBDINT_PROMPT, *LIBSSH2_USERAUTH_KBDINT_RESPONSE, [*c]*c_void) callconv(.C) void;
pub const struct_git_credential_ssh_interactive = extern struct {
    parent: git_credential,
    username: [*c]u8,
    prompt_callback: git_credential_ssh_interactive_cb,
    payload: *c_void,
};
pub const git_credential_ssh_interactive = struct_git_credential_ssh_interactive;
pub const struct__LIBSSH2_SESSION = opaque {};
pub const LIBSSH2_SESSION = struct__LIBSSH2_SESSION;
pub const git_credential_sign_cb = ?fn (*LIBSSH2_SESSION, [*c][*c]u8, [*c]usize, [*c]const u8, usize, [*c]*c_void) callconv(.C) c_int;
pub const struct_git_credential_ssh_custom = extern struct {
    parent: git_credential,
    username: [*c]u8,
    publickey: [*c]u8,
    publickey_len: usize,
    sign_callback: git_credential_sign_cb,
    payload: *c_void,
};
pub const git_credential_ssh_custom = struct_git_credential_ssh_custom;
pub const GIT_PACKBUILDER_ADDING_OBJECTS: c_int = 0;
pub const GIT_PACKBUILDER_DELTAFICATION: c_int = 1;
pub const git_packbuilder_stage_t = c_uint;
pub const git_packbuilder_foreach_cb = ?fn (*c_void, usize, *c_void) callconv(.C) c_int;
pub const GIT_PROXY_NONE: c_int = 0;
pub const GIT_PROXY_AUTO: c_int = 1;
pub const GIT_PROXY_SPECIFIED: c_int = 2;
pub const git_proxy_t = c_uint;
pub const git_proxy_options = extern struct {
    version: c_uint,
    type: git_proxy_t,
    url: [*c]const u8,
    credentials: git_credential_acquire_cb,
    certificate_check: git_transport_certificate_check_cb,
    payload: *c_void,
};
pub const GIT_REMOTE_CREATE_SKIP_INSTEADOF: c_int = 1;
pub const GIT_REMOTE_CREATE_SKIP_DEFAULT_FETCHSPEC: c_int = 2;
pub const git_remote_create_flags = c_uint;
pub const struct_git_remote_create_options = extern struct {
    version: c_uint,
    repository: *git_repository,
    name: [*c]const u8,
    fetchspec: [*c]const u8,
    flags: c_uint,
};
pub const git_remote_create_options = struct_git_remote_create_options;
pub const git_push_update = extern struct {
    src_refname: [*c]u8,
    dst_refname: [*c]u8,
    src: git_oid,
    dst: git_oid,
};
pub const GIT_FETCH_PRUNE_UNSPECIFIED: c_int = 0;
pub const GIT_FETCH_PRUNE: c_int = 1;
pub const GIT_FETCH_NO_PRUNE: c_int = 2;
pub const git_fetch_prune_t = c_uint;
pub const GIT_REMOTE_DOWNLOAD_TAGS_UNSPECIFIED: c_int = 0;
pub const GIT_REMOTE_DOWNLOAD_TAGS_AUTO: c_int = 1;
pub const GIT_REMOTE_DOWNLOAD_TAGS_NONE: c_int = 2;
pub const GIT_REMOTE_DOWNLOAD_TAGS_ALL: c_int = 3;
pub const git_remote_autotag_option_t = c_uint;
pub const git_fetch_options = extern struct {
    version: c_int,
    callbacks: git_remote_callbacks,
    prune: git_fetch_prune_t,
    update_fetchhead: c_int,
    download_tags: git_remote_autotag_option_t,
    proxy_opts: git_proxy_options,
    custom_headers: git_strarray,
};
pub const git_push_options = extern struct {
    version: c_uint,
    pb_parallelism: c_uint,
    callbacks: git_remote_callbacks,
    proxy_opts: git_proxy_options,
    custom_headers: git_strarray,
};
pub const GIT_CLONE_LOCAL_AUTO: c_int = 0;
pub const GIT_CLONE_LOCAL: c_int = 1;
pub const GIT_CLONE_NO_LOCAL: c_int = 2;
pub const GIT_CLONE_LOCAL_NO_LINKS: c_int = 3;
pub const git_clone_local_t = c_uint;
pub const git_remote_create_cb = ?fn ([*c]*git_remote, *git_repository, [*c]const u8, [*c]const u8, *c_void) callconv(.C) c_int;
pub const git_repository_create_cb = ?fn (*git_repository, [*c]const u8, c_int, *c_void) callconv(.C) c_int;
pub const struct_git_clone_options = extern struct {
    version: c_uint,
    checkout_opts: git_checkout_options,
    fetch_opts: git_fetch_options,
    bare: c_int,
    local: git_clone_local_t,
    checkout_branch: [*c]const u8,
    repository_cb: git_repository_create_cb,
    repository_cb_payload: *c_void,
    remote_cb: git_remote_create_cb,
    remote_cb_payload: *c_void,
};
pub const git_clone_options = struct_git_clone_options;
pub const git_commit_create_cb = ?fn ([*c]git_oid, [*c]const git_signature, [*c]const git_signature, [*c]const u8, [*c]const u8, *const git_tree, usize, [*c]*const git_commit, *c_void) callconv(.C) c_int;
pub const GIT_CONFIG_LEVEL_PROGRAMDATA: c_int = 1;
pub const GIT_CONFIG_LEVEL_SYSTEM: c_int = 2;
pub const GIT_CONFIG_LEVEL_XDG: c_int = 3;
pub const GIT_CONFIG_LEVEL_GLOBAL: c_int = 4;
pub const GIT_CONFIG_LEVEL_LOCAL: c_int = 5;
pub const GIT_CONFIG_LEVEL_APP: c_int = 6;
pub const GIT_CONFIG_HIGHEST_LEVEL: c_int = -1;
pub const git_config_level_t = c_int;
pub const struct_git_config_entry = extern struct {
    name: [*c]const u8,
    value: [*c]const u8,
    include_depth: c_uint,
    level: git_config_level_t,
    free: ?fn ([*c]struct_git_config_entry) callconv(.C) void,
    payload: *c_void,
};
pub const git_config_entry = struct_git_config_entry;
pub const git_config_foreach_cb = ?fn ([*c]const git_config_entry, *c_void) callconv(.C) c_int;
pub const struct_git_config_iterator = opaque {};
pub const git_config_iterator = struct_git_config_iterator;
pub const GIT_CONFIGMAP_FALSE: c_int = 0;
pub const GIT_CONFIGMAP_TRUE: c_int = 1;
pub const GIT_CONFIGMAP_INT32: c_int = 2;
pub const GIT_CONFIGMAP_STRING: c_int = 3;
pub const git_configmap_t = c_uint;
pub const git_configmap = extern struct {
    type: git_configmap_t,
    str_match: [*c]const u8,
    map_value: c_int,
};
pub const GIT_DESCRIBE_DEFAULT: c_int = 0;
pub const GIT_DESCRIBE_TAGS: c_int = 1;
pub const GIT_DESCRIBE_ALL: c_int = 2;
pub const git_describe_strategy_t = c_uint;
pub const struct_git_describe_options = extern struct {
    version: c_uint,
    max_candidates_tags: c_uint,
    describe_strategy: c_uint,
    pattern: [*c]const u8,
    only_follow_first_parent: c_int,
    show_commit_oid_as_fallback: c_int,
};
pub const git_describe_options = struct_git_describe_options;
pub const git_describe_format_options = extern struct {
    version: c_uint,
    abbreviated_size: c_uint,
    always_use_long_format: c_int,
    dirty_suffix: [*c]const u8,
};
pub const struct_git_describe_result = opaque {};
pub const git_describe_result = struct_git_describe_result;
pub const GIT_OK: c_int = 0;
pub const GIT_ERROR: c_int = -1;
pub const GIT_ENOTFOUND: c_int = -3;
pub const GIT_EEXISTS: c_int = -4;
pub const GIT_EAMBIGUOUS: c_int = -5;
pub const GIT_EBUFS: c_int = -6;
pub const GIT_EUSER: c_int = -7;
pub const GIT_EBAREREPO: c_int = -8;
pub const GIT_EUNBORNBRANCH: c_int = -9;
pub const GIT_EUNMERGED: c_int = -10;
pub const GIT_ENONFASTFORWARD: c_int = -11;
pub const GIT_EINVALIDSPEC: c_int = -12;
pub const GIT_ECONFLICT: c_int = -13;
pub const GIT_ELOCKED: c_int = -14;
pub const GIT_EMODIFIED: c_int = -15;
pub const GIT_EAUTH: c_int = -16;
pub const GIT_ECERTIFICATE: c_int = -17;
pub const GIT_EAPPLIED: c_int = -18;
pub const GIT_EPEEL: c_int = -19;
pub const GIT_EEOF: c_int = -20;
pub const GIT_EINVALID: c_int = -21;
pub const GIT_EUNCOMMITTED: c_int = -22;
pub const GIT_EDIRECTORY: c_int = -23;
pub const GIT_EMERGECONFLICT: c_int = -24;
pub const GIT_PASSTHROUGH: c_int = -30;
pub const GIT_ITEROVER: c_int = -31;
pub const GIT_RETRY: c_int = -32;
pub const GIT_EMISMATCH: c_int = -33;
pub const GIT_EINDEXDIRTY: c_int = -34;
pub const GIT_EAPPLYFAIL: c_int = -35;
pub const git_error_code = c_int;
pub const git_error = extern struct {
    message: [*c]u8,
    klass: c_int,
};
pub const GIT_ERROR_NONE: c_int = 0;
pub const GIT_ERROR_NOMEMORY: c_int = 1;
pub const GIT_ERROR_OS: c_int = 2;
pub const GIT_ERROR_INVALID: c_int = 3;
pub const GIT_ERROR_REFERENCE: c_int = 4;
pub const GIT_ERROR_ZLIB: c_int = 5;
pub const GIT_ERROR_REPOSITORY: c_int = 6;
pub const GIT_ERROR_CONFIG: c_int = 7;
pub const GIT_ERROR_REGEX: c_int = 8;
pub const GIT_ERROR_ODB: c_int = 9;
pub const GIT_ERROR_INDEX: c_int = 10;
pub const GIT_ERROR_OBJECT: c_int = 11;
pub const GIT_ERROR_NET: c_int = 12;
pub const GIT_ERROR_TAG: c_int = 13;
pub const GIT_ERROR_TREE: c_int = 14;
pub const GIT_ERROR_INDEXER: c_int = 15;
pub const GIT_ERROR_SSL: c_int = 16;
pub const GIT_ERROR_SUBMODULE: c_int = 17;
pub const GIT_ERROR_THREAD: c_int = 18;
pub const GIT_ERROR_STASH: c_int = 19;
pub const GIT_ERROR_CHECKOUT: c_int = 20;
pub const GIT_ERROR_FETCHHEAD: c_int = 21;
pub const GIT_ERROR_MERGE: c_int = 22;
pub const GIT_ERROR_SSH: c_int = 23;
pub const GIT_ERROR_FILTER: c_int = 24;
pub const GIT_ERROR_REVERT: c_int = 25;
pub const GIT_ERROR_CALLBACK: c_int = 26;
pub const GIT_ERROR_CHERRYPICK: c_int = 27;
pub const GIT_ERROR_DESCRIBE: c_int = 28;
pub const GIT_ERROR_REBASE: c_int = 29;
pub const GIT_ERROR_FILESYSTEM: c_int = 30;
pub const GIT_ERROR_PATCH: c_int = 31;
pub const GIT_ERROR_WORKTREE: c_int = 32;
pub const GIT_ERROR_SHA1: c_int = 33;
pub const GIT_ERROR_HTTP: c_int = 34;
pub const GIT_ERROR_INTERNAL: c_int = 35;
pub const git_error_t = c_uint;
pub const GIT_FILTER_TO_WORKTREE: c_int = 0;
pub const GIT_FILTER_SMUDGE: c_int = 0;
pub const GIT_FILTER_TO_ODB: c_int = 1;
pub const GIT_FILTER_CLEAN: c_int = 1;
pub const git_filter_mode_t = c_uint;
pub const GIT_FILTER_DEFAULT: c_int = 0;
pub const GIT_FILTER_ALLOW_UNSAFE: c_int = 1;
pub const GIT_FILTER_NO_SYSTEM_ATTRIBUTES: c_int = 2;
pub const GIT_FILTER_ATTRIBUTES_FROM_HEAD: c_int = 4;
pub const GIT_FILTER_ATTRIBUTES_FROM_COMMIT: c_int = 8;
pub const git_filter_flag_t = c_uint;
pub const git_filter_options = extern struct {
    version: c_uint,
    flags: u32,
    commit_id: [*c]git_oid,
    attr_commit_id: git_oid,
};
pub const struct_git_filter = opaque {};
pub const git_filter = struct_git_filter;
pub const struct_git_filter_list = opaque {};
pub const git_filter_list = struct_git_filter_list;
pub const git_rebase_options = extern struct {
    version: c_uint,
    quiet: c_int,
    inmemory: c_int,
    rewrite_notes_ref: [*c]const u8,
    merge_options: git_merge_options,
    checkout_options: git_checkout_options,
    commit_create_cb: git_commit_create_cb,
    signing_cb: ?fn ([*c]git_buf, [*c]git_buf, [*c]const u8, *c_void) callconv(.C) c_int,
    payload: *c_void,
};
pub const GIT_REBASE_OPERATION_PICK: c_int = 0;
pub const GIT_REBASE_OPERATION_REWORD: c_int = 1;
pub const GIT_REBASE_OPERATION_EDIT: c_int = 2;
pub const GIT_REBASE_OPERATION_SQUASH: c_int = 3;
pub const GIT_REBASE_OPERATION_FIXUP: c_int = 4;
pub const GIT_REBASE_OPERATION_EXEC: c_int = 5;
pub const git_rebase_operation_t = c_uint;
pub const git_rebase_operation = extern struct {
    type: git_rebase_operation_t,
    id: git_oid,
    exec: [*c]const u8,
};
pub const GIT_TRACE_NONE: c_int = 0;
pub const GIT_TRACE_FATAL: c_int = 1;
pub const GIT_TRACE_ERROR: c_int = 2;
pub const GIT_TRACE_WARN: c_int = 3;
pub const GIT_TRACE_INFO: c_int = 4;
pub const GIT_TRACE_DEBUG: c_int = 5;
pub const GIT_TRACE_TRACE: c_int = 6;
pub const git_trace_level_t = c_uint;
pub const git_trace_cb = ?fn (git_trace_level_t, [*c]const u8) callconv(.C) void;
pub const git_revert_options = extern struct {
    version: c_uint,
    mainline: c_uint,
    merge_opts: git_merge_options,
    checkout_opts: git_checkout_options,
};
pub const GIT_REVSPEC_SINGLE: c_int = 1;
pub const GIT_REVSPEC_RANGE: c_int = 2;
pub const GIT_REVSPEC_MERGE_BASE: c_int = 4;
pub const git_revspec_t = c_uint;
pub const git_revspec = extern struct {
    from: *git_object,
    to: *git_object,
    flags: c_uint,
};
pub const GIT_STASH_DEFAULT: c_int = 0;
pub const GIT_STASH_KEEP_INDEX: c_int = 1;
pub const GIT_STASH_INCLUDE_UNTRACKED: c_int = 2;
pub const GIT_STASH_INCLUDE_IGNORED: c_int = 4;
pub const git_stash_flags = c_uint;
pub const GIT_STASH_APPLY_DEFAULT: c_int = 0;
pub const GIT_STASH_APPLY_REINSTATE_INDEX: c_int = 1;
pub const git_stash_apply_flags = c_uint;
pub const GIT_STASH_APPLY_PROGRESS_NONE: c_int = 0;
pub const GIT_STASH_APPLY_PROGRESS_LOADING_STASH: c_int = 1;
pub const GIT_STASH_APPLY_PROGRESS_ANALYZE_INDEX: c_int = 2;
pub const GIT_STASH_APPLY_PROGRESS_ANALYZE_MODIFIED: c_int = 3;
pub const GIT_STASH_APPLY_PROGRESS_ANALYZE_UNTRACKED: c_int = 4;
pub const GIT_STASH_APPLY_PROGRESS_CHECKOUT_UNTRACKED: c_int = 5;
pub const GIT_STASH_APPLY_PROGRESS_CHECKOUT_MODIFIED: c_int = 6;
pub const GIT_STASH_APPLY_PROGRESS_DONE: c_int = 7;
pub const git_stash_apply_progress_t = c_uint;
pub const git_stash_apply_progress_cb = ?fn (git_stash_apply_progress_t, *c_void) callconv(.C) c_int;
pub const struct_git_stash_apply_options = extern struct {
    version: c_uint,
    flags: u32,
    checkout_options: git_checkout_options,
    progress_cb: git_stash_apply_progress_cb,
    progress_payload: *c_void,
};
pub const git_stash_apply_options = struct_git_stash_apply_options;
pub const git_stash_cb = ?fn (usize, [*c]const u8, [*c]const git_oid, *c_void) callconv(.C) c_int;
pub const GIT_STATUS_CURRENT: c_int = 0;
pub const GIT_STATUS_INDEX_NEW: c_int = 1;
pub const GIT_STATUS_INDEX_MODIFIED: c_int = 2;
pub const GIT_STATUS_INDEX_DELETED: c_int = 4;
pub const GIT_STATUS_INDEX_RENAMED: c_int = 8;
pub const GIT_STATUS_INDEX_TYPECHANGE: c_int = 16;
pub const GIT_STATUS_WT_NEW: c_int = 128;
pub const GIT_STATUS_WT_MODIFIED: c_int = 256;
pub const GIT_STATUS_WT_DELETED: c_int = 512;
pub const GIT_STATUS_WT_TYPECHANGE: c_int = 1024;
pub const GIT_STATUS_WT_RENAMED: c_int = 2048;
pub const GIT_STATUS_WT_UNREADABLE: c_int = 4096;
pub const GIT_STATUS_IGNORED: c_int = 16384;
pub const GIT_STATUS_CONFLICTED: c_int = 32768;
pub const git_status_t = c_uint;
pub const git_status_cb = ?fn ([*c]const u8, c_uint, *c_void) callconv(.C) c_int;
pub const GIT_STATUS_SHOW_INDEX_AND_WORKDIR: c_int = 0;
pub const GIT_STATUS_SHOW_INDEX_ONLY: c_int = 1;
pub const GIT_STATUS_SHOW_WORKDIR_ONLY: c_int = 2;
pub const git_status_show_t = c_uint;
pub const GIT_STATUS_OPT_INCLUDE_UNTRACKED: c_int = 1;
pub const GIT_STATUS_OPT_INCLUDE_IGNORED: c_int = 2;
pub const GIT_STATUS_OPT_INCLUDE_UNMODIFIED: c_int = 4;
pub const GIT_STATUS_OPT_EXCLUDE_SUBMODULES: c_int = 8;
pub const GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS: c_int = 16;
pub const GIT_STATUS_OPT_DISABLE_PATHSPEC_MATCH: c_int = 32;
pub const GIT_STATUS_OPT_RECURSE_IGNORED_DIRS: c_int = 64;
pub const GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX: c_int = 128;
pub const GIT_STATUS_OPT_RENAMES_INDEX_TO_WORKDIR: c_int = 256;
pub const GIT_STATUS_OPT_SORT_CASE_SENSITIVELY: c_int = 512;
pub const GIT_STATUS_OPT_SORT_CASE_INSENSITIVELY: c_int = 1024;
pub const GIT_STATUS_OPT_RENAMES_FROM_REWRITES: c_int = 2048;
pub const GIT_STATUS_OPT_NO_REFRESH: c_int = 4096;
pub const GIT_STATUS_OPT_UPDATE_INDEX: c_int = 8192;
pub const GIT_STATUS_OPT_INCLUDE_UNREADABLE: c_int = 16384;
pub const GIT_STATUS_OPT_INCLUDE_UNREADABLE_AS_UNTRACKED: c_int = 32768;
pub const git_status_opt_t = c_uint;
pub const git_status_options = extern struct {
    version: c_uint,
    show: git_status_show_t,
    flags: c_uint,
    pathspec: git_strarray,
    baseline: *git_tree,
};
pub const git_status_entry = extern struct {
    status: git_status_t,
    head_to_index: [*c]git_diff_delta,
    index_to_workdir: [*c]git_diff_delta,
};
pub const GIT_SUBMODULE_STATUS_IN_HEAD: c_int = 1;
pub const GIT_SUBMODULE_STATUS_IN_INDEX: c_int = 2;
pub const GIT_SUBMODULE_STATUS_IN_CONFIG: c_int = 4;
pub const GIT_SUBMODULE_STATUS_IN_WD: c_int = 8;
pub const GIT_SUBMODULE_STATUS_INDEX_ADDED: c_int = 16;
pub const GIT_SUBMODULE_STATUS_INDEX_DELETED: c_int = 32;
pub const GIT_SUBMODULE_STATUS_INDEX_MODIFIED: c_int = 64;
pub const GIT_SUBMODULE_STATUS_WD_UNINITIALIZED: c_int = 128;
pub const GIT_SUBMODULE_STATUS_WD_ADDED: c_int = 256;
pub const GIT_SUBMODULE_STATUS_WD_DELETED: c_int = 512;
pub const GIT_SUBMODULE_STATUS_WD_MODIFIED: c_int = 1024;
pub const GIT_SUBMODULE_STATUS_WD_INDEX_MODIFIED: c_int = 2048;
pub const GIT_SUBMODULE_STATUS_WD_WD_MODIFIED: c_int = 4096;
pub const GIT_SUBMODULE_STATUS_WD_UNTRACKED: c_int = 8192;
pub const git_submodule_status_t = c_uint;
pub const git_submodule_cb = ?fn (*git_submodule, [*c]const u8, *c_void) callconv(.C) c_int;
pub const struct_git_submodule_update_options = extern struct {
    version: c_uint,
    checkout_opts: git_checkout_options,
    fetch_opts: git_fetch_options,
    allow_fetch: c_int,
};
pub const git_submodule_update_options = struct_git_submodule_update_options;
pub const struct_git_worktree_add_options = extern struct {
    version: c_uint,
    lock: c_int,
    ref: *git_reference,
};
pub const git_worktree_add_options = struct_git_worktree_add_options;
pub const GIT_WORKTREE_PRUNE_VALID: c_int = 1;
pub const GIT_WORKTREE_PRUNE_LOCKED: c_int = 2;
pub const GIT_WORKTREE_PRUNE_WORKING_TREE: c_int = 4;
pub const git_worktree_prune_t = c_uint;
pub const struct_git_worktree_prune_options = extern struct {
    version: c_uint,
    flags: u32,
};
pub const git_worktree_prune_options = struct_git_worktree_prune_options;
pub const struct_git_credential_userpass_payload = extern struct {
    username: [*c]const u8,
    password: [*c]const u8,
};
pub const git_credential_userpass_payload = struct_git_credential_userpass_payload;
pub const git_attr_t = git_attr_value_t;
pub const git_commit_signing_cb = ?fn ([*c]git_buf, [*c]git_buf, [*c]const u8, *c_void) callconv(.C) c_int;
pub const git_cvar_map = git_configmap;
pub const GIT_DIFF_FORMAT_EMAIL_NONE: c_int = 0;
pub const GIT_DIFF_FORMAT_EMAIL_EXCLUDE_SUBJECT_PATCH_MARKER: c_int = 1;
pub const git_diff_format_email_flags_t = c_uint;
pub const git_diff_format_email_options = extern struct {
    version: c_uint,
    flags: u32,
    patch_no: usize,
    total_patches: usize,
    id: [*c]const git_oid,
    summary: [*c]const u8,
    body: [*c]const u8,
    author: [*c]const git_signature,
};
pub const git_revparse_mode_t = git_revspec_t;
pub const git_cred = git_credential;
pub const git_cred_userpass_plaintext = git_credential_userpass_plaintext;
pub const git_cred_username = git_credential_username;
pub const git_cred_default = git_credential_default;
pub const git_cred_ssh_key = git_credential_ssh_key;
pub const git_cred_ssh_interactive = git_credential_ssh_interactive;
pub const git_cred_ssh_custom = git_credential_ssh_custom;
pub const git_cred_acquire_cb = git_credential_acquire_cb;
pub const git_cred_sign_callback = git_credential_sign_cb;
pub const git_cred_sign_cb = git_credential_sign_cb;
pub const git_cred_ssh_interactive_callback = git_credential_ssh_interactive_cb;
pub const git_cred_ssh_interactive_cb = git_credential_ssh_interactive_cb;
pub const git_cred_userpass_payload = git_credential_userpass_payload;
pub const git_trace_callback = git_trace_cb;
pub const git_transfer_progress = git_indexer_progress;
pub const git_transfer_progress_cb = git_indexer_progress_cb;
pub const git_push_transfer_progress = git_push_transfer_progress_cb;
pub const git_headlist_cb = ?fn ([*c]git_remote_head, *c_void) callconv(.C) c_int;
pub const GIT_EMAIL_CREATE_DEFAULT: c_int = 0;
pub const GIT_EMAIL_CREATE_OMIT_NUMBERS: c_int = 1;
pub const GIT_EMAIL_CREATE_ALWAYS_NUMBER: c_int = 2;
pub const GIT_EMAIL_CREATE_NO_RENAMES: c_int = 4;
pub const git_email_create_flags_t = c_uint;
pub const git_email_create_options = extern struct {
    version: c_uint,
    flags: u32,
    diff_opts: git_diff_options,
    diff_find_opts: git_diff_find_options,
    subject_prefix: [*c]const u8,
    start_number: usize,
    reroll_number: usize,
};
pub const git_message_trailer = extern struct {
    key: [*c]const u8,
    value: [*c]const u8,
};
pub const git_message_trailer_array = extern struct {
    trailers: [*c]git_message_trailer,
    count: usize,
    _trailer_block: [*c]u8,
};
pub const git_note_foreach_cb = ?fn ([*c]const git_oid, [*c]const git_oid, *c_void) callconv(.C) c_int;
pub const struct_git_iterator = opaque {};
pub const git_note_iterator = struct_git_iterator;
pub const git_odb_foreach_cb = ?fn ([*c]const git_oid, *c_void) callconv(.C) c_int;
pub const struct_git_odb_expand_id = extern struct {
    id: git_oid,
    length: c_ushort,
    type: git_object_t,
};
pub const git_odb_expand_id = struct_git_odb_expand_id;
pub const GIT_STREAM_RDONLY: c_int = 2;
pub const GIT_STREAM_WRONLY: c_int = 4;
pub const GIT_STREAM_RW: c_int = 6;
pub const git_odb_stream_t = c_uint;
pub const struct_git_patch = opaque {};
pub const git_patch = struct_git_patch;
pub const struct_git_pathspec = opaque {};
pub const git_pathspec = struct_git_pathspec;
pub const struct_git_pathspec_match_list = opaque {};
pub const git_pathspec_match_list = struct_git_pathspec_match_list;
pub const GIT_PATHSPEC_DEFAULT: c_int = 0;
pub const GIT_PATHSPEC_IGNORE_CASE: c_int = 1;
pub const GIT_PATHSPEC_USE_CASE: c_int = 2;
pub const GIT_PATHSPEC_NO_GLOB: c_int = 4;
pub const GIT_PATHSPEC_NO_MATCH_ERROR: c_int = 8;
pub const GIT_PATHSPEC_FIND_FAILURES: c_int = 16;
pub const GIT_PATHSPEC_FAILURES_ONLY: c_int = 32;
pub const git_pathspec_flag_t = c_uint;
pub const GIT_RESET_SOFT: c_int = 1;
pub const GIT_RESET_MIXED: c_int = 2;
pub const GIT_RESET_HARD: c_int = 3;
pub const git_reset_t = c_uint;
pub const GIT_SORT_NONE: c_int = 0;
pub const GIT_SORT_TOPOLOGICAL: c_int = 1;
pub const GIT_SORT_TIME: c_int = 2;
pub const GIT_SORT_REVERSE: c_int = 4;
pub const git_sort_t = c_uint;
pub const git_revwalk_hide_cb = ?fn ([*c]const git_oid, *c_void) callconv(.C) c_int;
pub const git_tag_foreach_cb = ?fn ([*c]const u8, [*c]git_oid, *c_void) callconv(.C) c_int;

pub const git_libgit2_version = fn (major: [*c]c_int, minor: [*c]c_int, rev: [*c]c_int) callconv(.C) c_int;
pub const git_libgit2_features = fn () callconv(.C) c_int;
pub const git_libgit2_opts = fn (option: c_int, ...) callconv(.C) c_int;
pub const git_buf_dispose = fn (buffer: [*c]git_buf) callconv(.C) void;
pub const git_buf_grow = fn (buffer: [*c]git_buf, target_size: usize) callconv(.C) c_int;
pub const git_buf_set = fn (buffer: [*c]git_buf, data: *const c_void, datalen: usize) callconv(.C) c_int;
pub const git_buf_is_binary = fn (buf: [*c]const git_buf) callconv(.C) c_int;
pub const git_buf_contains_nul = fn (buf: [*c]const git_buf) callconv(.C) c_int;
pub const git_oid_fromstr = fn (out: [*c]git_oid, str: [*c]const u8) callconv(.C) c_int;
pub const git_oid_fromstrp = fn (out: [*c]git_oid, str: [*c]const u8) callconv(.C) c_int;
pub const git_oid_fromstrn = fn (out: [*c]git_oid, str: [*c]const u8, length: usize) callconv(.C) c_int;
pub const git_oid_fromraw = fn (out: [*c]git_oid, raw: [*c]const u8) callconv(.C) c_int;
pub const git_oid_fmt = fn (out: [*c]u8, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_nfmt = fn (out: [*c]u8, n: usize, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_pathfmt = fn (out: [*c]u8, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_tostr_s = fn (oid: [*c]const git_oid) callconv(.C) [*c]u8;
pub const git_oid_tostr = fn (out: [*c]u8, n: usize, id: [*c]const git_oid) callconv(.C) [*c]u8;
pub const git_oid_cpy = fn (out: [*c]git_oid, src: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_cmp = fn (a: [*c]const git_oid, b: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_equal = fn (a: [*c]const git_oid, b: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_ncmp = fn (a: [*c]const git_oid, b: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_oid_streq = fn (id: [*c]const git_oid, str: [*c]const u8) callconv(.C) c_int;
pub const git_oid_strcmp = fn (id: [*c]const git_oid, str: [*c]const u8) callconv(.C) c_int;
pub const git_oid_is_zero = fn (id: [*c]const git_oid) callconv(.C) c_int;
pub const git_oid_shorten_new = fn (min_length: usize) callconv(.C) *git_oid_shorten;
pub const git_oid_shorten_add = fn (os: *git_oid_shorten, text_id: [*c]const u8) callconv(.C) c_int;
pub const git_oid_shorten_free = fn (os: *git_oid_shorten) callconv(.C) void;
pub const git_repository_open = fn (out: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_repository_open_from_worktree = fn (out: *git_repository, wt: *git_worktree) callconv(.C) c_int;
pub const git_repository_wrap_odb = fn (out: *git_repository, odb: *git_odb) callconv(.C) c_int;
pub const git_repository_discover = fn (out: [*c]git_buf, start_path: [*c]const u8, across_fs: c_int, ceiling_dirs: [*c]const u8) callconv(.C) c_int;
pub const git_repository_open_ext = fn (out: *git_repository, path: [*c]const u8, flags: c_uint, ceiling_dirs: [*c]const u8) callconv(.C) c_int;
pub const git_repository_open_bare = fn (out: *git_repository, bare_path: [*c]const u8) callconv(.C) c_int;
pub const git_repository_free = fn (repo: *git_repository) callconv(.C) void;
pub const git_repository_init = fn (out: *?*git_repository, path: [*c]const u8, is_bare: c_uint) callconv(.C) c_int;
pub const git_repository_init_options_init = fn (opts: ?*git_repository_init_options, version: c_uint) callconv(.C) c_int;
pub const git_repository_init_ext = fn (out: ?*git_repository, repo_path: [*c]const u8, opts: ?*git_repository_init_options) callconv(.C) c_int;
pub const git_repository_head = fn (out: [*c]*git_reference, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_head_for_worktree = fn (out: [*c]*git_reference, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_repository_head_detached = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_head_detached_for_worktree = fn (repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_repository_head_unborn = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_is_empty = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_item_path = fn (out: [*c]git_buf, repo: *const git_repository, item: git_repository_item_t) callconv(.C) c_int;
pub const git_repository_path = fn (repo: *const git_repository) callconv(.C) [*c]const u8;
pub const git_repository_workdir = fn (repo: *const git_repository) callconv(.C) [*c]const u8;
pub const git_repository_commondir = fn (repo: *const git_repository) callconv(.C) [*c]const u8;
pub const git_repository_set_workdir = fn (repo: *git_repository, workdir: [*c]const u8, update_gitlink: c_int) callconv(.C) c_int;
pub const git_repository_is_bare = fn (repo: *const git_repository) callconv(.C) c_int;
pub const git_repository_is_worktree = fn (repo: *const git_repository) callconv(.C) c_int;
pub const git_repository_config = fn (out: [*c]*git_config, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_config_snapshot = fn (out: [*c]*git_config, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_odb = fn (out: [*c]*git_odb, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_refdb = fn (out: [*c]*git_refdb, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_index = fn (out: *?*git_index, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_message = fn (out: [*c]git_buf, repo: *git_repository) callconv(.C) c_int;
pub const git_repository_message_remove = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_state_cleanup = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_fetchhead_foreach = fn (repo: *git_repository, callback: git_repository_fetchhead_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_repository_mergehead_foreach = fn (repo: *git_repository, callback: git_repository_mergehead_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_repository_hashfile = fn (out: [*c]git_oid, repo: *git_repository, path: [*c]const u8, @"type": git_object_t, as_path: [*c]const u8) callconv(.C) c_int;
pub const git_repository_set_head = fn (repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_repository_set_head_detached = fn (repo: *git_repository, commitish: [*c]const git_oid) callconv(.C) c_int;
pub const git_repository_set_head_detached_from_annotated = fn (repo: *git_repository, commitish: *const git_annotated_commit) callconv(.C) c_int;
pub const git_repository_detach_head = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_state = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_set_namespace = fn (repo: *git_repository, nmspace: [*c]const u8) callconv(.C) c_int;
pub const git_repository_get_namespace = fn (repo: *git_repository) callconv(.C) [*c]const u8;
pub const git_repository_is_shallow = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_repository_ident = fn (name: [*c][*c]const u8, email: [*c][*c]const u8, repo: *const git_repository) callconv(.C) c_int;
pub const git_repository_set_ident = fn (repo: *git_repository, name: [*c]const u8, email: [*c]const u8) callconv(.C) c_int;
pub const git_annotated_commit_from_ref = fn (out: [*c]*git_annotated_commit, repo: *git_repository, ref: *const git_reference) callconv(.C) c_int;
pub const git_annotated_commit_from_fetchhead = fn (out: [*c]*git_annotated_commit, repo: *git_repository, branch_name: [*c]const u8, remote_url: [*c]const u8, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_annotated_commit_lookup = fn (out: [*c]*git_annotated_commit, repo: *git_repository, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_annotated_commit_from_revspec = fn (out: [*c]*git_annotated_commit, repo: *git_repository, revspec: [*c]const u8) callconv(.C) c_int;
pub const git_annotated_commit_id = fn (commit: *const git_annotated_commit) callconv(.C) [*c]const git_oid;
pub const git_annotated_commit_ref = fn (commit: *const git_annotated_commit) callconv(.C) [*c]const u8;
pub const git_annotated_commit_free = fn (commit: *git_annotated_commit) callconv(.C) void;
pub const git_object_lookup = fn (object: [*c]*git_object, repo: *git_repository, id: [*c]const git_oid, @"type": git_object_t) callconv(.C) c_int;
pub const git_object_lookup_prefix = fn (object_out: [*c]*git_object, repo: *git_repository, id: [*c]const git_oid, len: usize, @"type": git_object_t) callconv(.C) c_int;
pub const git_object_lookup_bypath = fn (out: [*c]*git_object, treeish: *const git_object, path: [*c]const u8, @"type": git_object_t) callconv(.C) c_int;
pub const git_object_id = fn (obj: *const git_object) callconv(.C) [*c]const git_oid;
pub const git_object_short_id = fn (out: [*c]git_buf, obj: *const git_object) callconv(.C) c_int;
pub const git_object_type = fn (obj: *const git_object) callconv(.C) git_object_t;
pub const git_object_owner = fn (obj: *const git_object) callconv(.C) *git_repository;
pub const git_object_free = fn (object: *git_object) callconv(.C) void;
pub const git_object_type2string = fn (@"type": git_object_t) callconv(.C) [*c]const u8;
pub const git_object_string2type = fn (str: [*c]const u8) callconv(.C) git_object_t;
pub const git_object_typeisloose = fn (@"type": git_object_t) callconv(.C) c_int;
pub const git_object_peel = fn (peeled: [*c]*git_object, object: *const git_object, target_type: git_object_t) callconv(.C) c_int;
pub const git_object_dup = fn (dest: [*c]*git_object, source: *git_object) callconv(.C) c_int;
pub const git_tree_lookup = fn (out: [*c]*git_tree, repo: *git_repository, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_tree_lookup_prefix = fn (out: [*c]*git_tree, repo: *git_repository, id: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_tree_free = fn (tree: *git_tree) callconv(.C) void;
pub const git_tree_id = fn (tree: *const git_tree) callconv(.C) [*c]const git_oid;
pub const git_tree_owner = fn (tree: *const git_tree) callconv(.C) *git_repository;
pub const git_tree_entrycount = fn (tree: *const git_tree) callconv(.C) usize;
pub const git_tree_entry_byname = fn (tree: *const git_tree, filename: [*c]const u8) callconv(.C) *const git_tree_entry;
pub const git_tree_entry_byindex = fn (tree: *const git_tree, idx: usize) callconv(.C) *const git_tree_entry;
pub const git_tree_entry_byid = fn (tree: *const git_tree, id: [*c]const git_oid) callconv(.C) *const git_tree_entry;
pub const git_tree_entry_bypath = fn (out: [*c]*git_tree_entry, root: *const git_tree, path: [*c]const u8) callconv(.C) c_int;
pub const git_tree_entry_dup = fn (dest: [*c]*git_tree_entry, source: *const git_tree_entry) callconv(.C) c_int;
pub const git_tree_entry_free = fn (entry: *git_tree_entry) callconv(.C) void;
pub const git_tree_entry_name = fn (entry: *const git_tree_entry) callconv(.C) [*c]const u8;
pub const git_tree_entry_id = fn (entry: *const git_tree_entry) callconv(.C) [*c]const git_oid;
pub const git_tree_entry_type = fn (entry: *const git_tree_entry) callconv(.C) git_object_t;
pub const git_tree_entry_filemode = fn (entry: *const git_tree_entry) callconv(.C) git_filemode_t;
pub const git_tree_entry_filemode_raw = fn (entry: *const git_tree_entry) callconv(.C) git_filemode_t;
pub const git_tree_entry_cmp = fn (e1: *const git_tree_entry, e2: *const git_tree_entry) callconv(.C) c_int;
pub const git_tree_entry_to_object = fn (object_out: [*c]*git_object, repo: *git_repository, entry: *const git_tree_entry) callconv(.C) c_int;
pub const git_treebuilder_new = fn (out: [*c]*git_treebuilder, repo: *git_repository, source: *const git_tree) callconv(.C) c_int;
pub const git_treebuilder_clear = fn (bld: *git_treebuilder) callconv(.C) c_int;
pub const git_treebuilder_entrycount = fn (bld: *git_treebuilder) callconv(.C) usize;
pub const git_treebuilder_free = fn (bld: *git_treebuilder) callconv(.C) void;
pub const git_treebuilder_get = fn (bld: *git_treebuilder, filename: [*c]const u8) callconv(.C) *const git_tree_entry;
pub const git_treebuilder_insert = fn (out: [*c]*const git_tree_entry, bld: *git_treebuilder, filename: [*c]const u8, id: [*c]const git_oid, filemode: git_filemode_t) callconv(.C) c_int;
pub const git_treebuilder_remove = fn (bld: *git_treebuilder, filename: [*c]const u8) callconv(.C) c_int;
pub const git_treebuilder_filter = fn (bld: *git_treebuilder, filter: git_treebuilder_filter_cb, payload: *c_void) callconv(.C) c_int;
pub const git_treebuilder_write = fn (id: [*c]git_oid, bld: *git_treebuilder) callconv(.C) c_int;
pub const git_tree_walk = fn (tree: *const git_tree, mode: git_treewalk_mode, callback: git_treewalk_cb, payload: *c_void) callconv(.C) c_int;
pub const git_tree_dup = fn (out: [*c]*git_tree, source: *git_tree) callconv(.C) c_int;
pub const git_tree_create_updated = fn (out: [*c]git_oid, repo: *git_repository, baseline: *git_tree, nupdates: usize, updates: [*c]const git_tree_update) callconv(.C) c_int;
pub const git_strarray_dispose = fn (array: [*c]git_strarray) callconv(.C) void;
pub const git_strarray_copy = fn (tgt: [*c]git_strarray, src: [*c]const git_strarray) callconv(.C) c_int;
pub const git_reference_lookup = fn (out: [*c]*git_reference, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_reference_name_to_id = fn (out: [*c]git_oid, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_reference_dwim = fn (out: [*c]*git_reference, repo: *git_repository, shorthand: [*c]const u8) callconv(.C) c_int;
pub const git_reference_symbolic_create_matching = fn (out: [*c]*git_reference, repo: *git_repository, name: [*c]const u8, target: [*c]const u8, force: c_int, current_value: [*c]const u8, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_symbolic_create = fn (out: [*c]*git_reference, repo: *git_repository, name: [*c]const u8, target: [*c]const u8, force: c_int, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_create = fn (out: [*c]*git_reference, repo: *git_repository, name: [*c]const u8, id: [*c]const git_oid, force: c_int, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_create_matching = fn (out: [*c]*git_reference, repo: *git_repository, name: [*c]const u8, id: [*c]const git_oid, force: c_int, current_id: [*c]const git_oid, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_target = fn (ref: *const git_reference) callconv(.C) [*c]const git_oid;
pub const git_reference_target_peel = fn (ref: *const git_reference) callconv(.C) [*c]const git_oid;
pub const git_reference_symbolic_target = fn (ref: *const git_reference) callconv(.C) [*c]const u8;
pub const git_reference_type = fn (ref: *const git_reference) callconv(.C) git_reference_t;
pub const git_reference_name = fn (ref: *const git_reference) callconv(.C) [*c]const u8;
pub const git_reference_resolve = fn (out: [*c]*git_reference, ref: *const git_reference) callconv(.C) c_int;
pub const git_reference_owner = fn (ref: *const git_reference) callconv(.C) *git_repository;
pub const git_reference_symbolic_set_target = fn (out: [*c]*git_reference, ref: *git_reference, target: [*c]const u8, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_set_target = fn (out: [*c]*git_reference, ref: *git_reference, id: [*c]const git_oid, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_rename = fn (new_ref: [*c]*git_reference, ref: *git_reference, new_name: [*c]const u8, force: c_int, log_message: [*c]const u8) callconv(.C) c_int;
pub const git_reference_delete = fn (ref: *git_reference) callconv(.C) c_int;
pub const git_reference_remove = fn (repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_reference_list = fn (array: [*c]git_strarray, repo: *git_repository) callconv(.C) c_int;
pub const git_reference_foreach = fn (repo: *git_repository, callback: git_reference_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_reference_foreach_name = fn (repo: *git_repository, callback: git_reference_foreach_name_cb, payload: *c_void) callconv(.C) c_int;
pub const git_reference_dup = fn (dest: [*c]*git_reference, source: *git_reference) callconv(.C) c_int;
pub const git_reference_free = fn (ref: *git_reference) callconv(.C) void;
pub const git_reference_cmp = fn (ref1: *const git_reference, ref2: *const git_reference) callconv(.C) c_int;
pub const git_reference_iterator_new = fn (out: [*c]*git_reference_iterator, repo: *git_repository) callconv(.C) c_int;
pub const git_reference_iterator_glob_new = fn (out: [*c]*git_reference_iterator, repo: *git_repository, glob: [*c]const u8) callconv(.C) c_int;
pub const git_reference_next = fn (out: [*c]*git_reference, iter: *git_reference_iterator) callconv(.C) c_int;
pub const git_reference_next_name = fn (out: [*c][*c]const u8, iter: *git_reference_iterator) callconv(.C) c_int;
pub const git_reference_iterator_free = fn (iter: *git_reference_iterator) callconv(.C) void;
pub const git_reference_foreach_glob = fn (repo: *git_repository, glob: [*c]const u8, callback: git_reference_foreach_name_cb, payload: *c_void) callconv(.C) c_int;
pub const git_reference_has_log = fn (repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_reference_ensure_log = fn (repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_reference_is_branch = fn (ref: *const git_reference) callconv(.C) c_int;
pub const git_reference_is_remote = fn (ref: *const git_reference) callconv(.C) c_int;
pub const git_reference_is_tag = fn (ref: *const git_reference) callconv(.C) c_int;
pub const git_reference_is_note = fn (ref: *const git_reference) callconv(.C) c_int;
pub const git_reference_normalize_name = fn (buffer_out: [*c]u8, buffer_size: usize, name: [*c]const u8, flags: c_uint) callconv(.C) c_int;
pub const git_reference_peel = fn (out: [*c]*git_object, ref: *const git_reference, @"type": git_object_t) callconv(.C) c_int;
pub const git_reference_name_is_valid = fn (valid: [*c]c_int, refname: [*c]const u8) callconv(.C) c_int;
pub const git_reference_shorthand = fn (ref: *const git_reference) callconv(.C) [*c]const u8;
pub const git_diff_options_init = fn (opts: [*c]git_diff_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_find_options_init = fn (opts: [*c]git_diff_find_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_free = fn (diff: *git_diff) callconv(.C) void;
pub const git_diff_tree_to_tree = fn (diff: [*c]*git_diff, repo: *git_repository, old_tree: *git_tree, new_tree: *git_tree, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_tree_to_index = fn (diff: [*c]*git_diff, repo: *git_repository, old_tree: *git_tree, index: *git_index, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_index_to_workdir = fn (diff: [*c]*git_diff, repo: *git_repository, index: *git_index, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_tree_to_workdir = fn (diff: [*c]*git_diff, repo: *git_repository, old_tree: *git_tree, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_tree_to_workdir_with_index = fn (diff: [*c]*git_diff, repo: *git_repository, old_tree: *git_tree, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_index_to_index = fn (diff: [*c]*git_diff, repo: *git_repository, old_index: *git_index, new_index: *git_index, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_merge = fn (onto: *git_diff, from: *const git_diff) callconv(.C) c_int;
pub const git_diff_find_similar = fn (diff: *git_diff, options: [*c]const git_diff_find_options) callconv(.C) c_int;
pub const git_diff_num_deltas = fn (diff: *const git_diff) callconv(.C) usize;
pub const git_diff_num_deltas_of_type = fn (diff: *const git_diff, @"type": git_delta_t) callconv(.C) usize;
pub const git_diff_get_delta = fn (diff: *const git_diff, idx: usize) callconv(.C) [*c]const git_diff_delta;
pub const git_diff_is_sorted_icase = fn (diff: *const git_diff) callconv(.C) c_int;
pub const git_diff_foreach = fn (diff: *git_diff, file_cb: git_diff_file_cb, binary_cb: git_diff_binary_cb, hunk_cb: git_diff_hunk_cb, line_cb: git_diff_line_cb, payload: *c_void) callconv(.C) c_int;
pub const git_diff_status_char = fn (status: git_delta_t) callconv(.C) u8;
pub const git_diff_print = fn (diff: *git_diff, format: git_diff_format_t, print_cb: git_diff_line_cb, payload: *c_void) callconv(.C) c_int;
pub const git_diff_to_buf = fn (out: [*c]git_buf, diff: *git_diff, format: git_diff_format_t) callconv(.C) c_int;
pub const git_diff_blobs = fn (old_blob: *const git_blob, old_as_path: [*c]const u8, new_blob: *const git_blob, new_as_path: [*c]const u8, options: [*c]const git_diff_options, file_cb: git_diff_file_cb, binary_cb: git_diff_binary_cb, hunk_cb: git_diff_hunk_cb, line_cb: git_diff_line_cb, payload: *c_void) callconv(.C) c_int;
pub const git_diff_blob_to_buffer = fn (old_blob: *const git_blob, old_as_path: [*c]const u8, buffer: [*c]const u8, buffer_len: usize, buffer_as_path: [*c]const u8, options: [*c]const git_diff_options, file_cb: git_diff_file_cb, binary_cb: git_diff_binary_cb, hunk_cb: git_diff_hunk_cb, line_cb: git_diff_line_cb, payload: *c_void) callconv(.C) c_int;
pub const git_diff_buffers = fn (old_buffer: *const c_void, old_len: usize, old_as_path: [*c]const u8, new_buffer: *const c_void, new_len: usize, new_as_path: [*c]const u8, options: [*c]const git_diff_options, file_cb: git_diff_file_cb, binary_cb: git_diff_binary_cb, hunk_cb: git_diff_hunk_cb, line_cb: git_diff_line_cb, payload: *c_void) callconv(.C) c_int;
pub const git_diff_from_buffer = fn (out: [*c]*git_diff, content: [*c]const u8, content_len: usize) callconv(.C) c_int;
pub const git_diff_get_stats = fn (out: [*c]*git_diff_stats, diff: *git_diff) callconv(.C) c_int;
pub const git_diff_stats_files_changed = fn (stats: *const git_diff_stats) callconv(.C) usize;
pub const git_diff_stats_insertions = fn (stats: *const git_diff_stats) callconv(.C) usize;
pub const git_diff_stats_deletions = fn (stats: *const git_diff_stats) callconv(.C) usize;
pub const git_diff_stats_to_buf = fn (out: [*c]git_buf, stats: *const git_diff_stats, format: git_diff_stats_format_t, width: usize) callconv(.C) c_int;
pub const git_diff_stats_free = fn (stats: *git_diff_stats) callconv(.C) void;
pub const git_diff_patchid_options_init = fn (opts: [*c]git_diff_patchid_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_patchid = fn (out: [*c]git_oid, diff: *git_diff, opts: [*c]git_diff_patchid_options) callconv(.C) c_int;
pub const git_apply_options_init = fn (opts: [*c]git_apply_options, version: c_uint) callconv(.C) c_int;
pub const git_apply_to_tree = fn (out: [*c]*git_index, repo: *git_repository, preimage: *git_tree, diff: *git_diff, options: [*c]const git_apply_options) callconv(.C) c_int;
pub const git_apply = fn (repo: *git_repository, diff: *git_diff, location: git_apply_location_t, options: [*c]const git_apply_options) callconv(.C) c_int;
pub const git_attr_value = fn (attr: [*c]const u8) callconv(.C) git_attr_value_t;
pub const git_attr_get = fn (value_out: [*c][*c]const u8, repo: *git_repository, flags: u32, path: [*c]const u8, name: [*c]const u8) callconv(.C) c_int;
pub const git_attr_get_ext = fn (value_out: [*c][*c]const u8, repo: *git_repository, opts: [*c]git_attr_options, path: [*c]const u8, name: [*c]const u8) callconv(.C) c_int;
pub const git_attr_get_many = fn (values_out: [*c][*c]const u8, repo: *git_repository, flags: u32, path: [*c]const u8, num_attr: usize, names: [*c][*c]const u8) callconv(.C) c_int;
pub const git_attr_get_many_ext = fn (values_out: [*c][*c]const u8, repo: *git_repository, opts: [*c]git_attr_options, path: [*c]const u8, num_attr: usize, names: [*c][*c]const u8) callconv(.C) c_int;
pub const git_attr_foreach = fn (repo: *git_repository, flags: u32, path: [*c]const u8, callback: git_attr_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_attr_foreach_ext = fn (repo: *git_repository, opts: [*c]git_attr_options, path: [*c]const u8, callback: git_attr_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_attr_cache_flush = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_attr_add_macro = fn (repo: *git_repository, name: [*c]const u8, values: [*c]const u8) callconv(.C) c_int;
pub const git_blob_lookup = fn (blob: [*c]*git_blob, repo: *git_repository, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_blob_lookup_prefix = fn (blob: [*c]*git_blob, repo: *git_repository, id: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_blob_free = fn (blob: *git_blob) callconv(.C) void;
pub const git_blob_id = fn (blob: *const git_blob) callconv(.C) [*c]const git_oid;
pub const git_blob_owner = fn (blob: *const git_blob) callconv(.C) *git_repository;
pub const git_blob_rawcontent = fn (blob: *const git_blob) callconv(.C) *const c_void;
pub const git_blob_rawsize = fn (blob: *const git_blob) callconv(.C) git_object_size_t;
pub const git_blob_filter_options_init = fn (opts: [*c]git_blob_filter_options, version: c_uint) callconv(.C) c_int;
pub const git_blob_filter = fn (out: [*c]git_buf, blob: *git_blob, as_path: [*c]const u8, opts: [*c]git_blob_filter_options) callconv(.C) c_int;
pub const git_blob_create_from_workdir = fn (id: [*c]git_oid, repo: *git_repository, relative_path: [*c]const u8) callconv(.C) c_int;
pub const git_blob_create_from_disk = fn (id: [*c]git_oid, repo: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_blob_create_from_stream = fn (out: [*c][*c]git_writestream, repo: *git_repository, hintpath: [*c]const u8) callconv(.C) c_int;
pub const git_blob_create_from_stream_commit = fn (out: [*c]git_oid, stream: [*c]git_writestream) callconv(.C) c_int;
pub const git_blob_create_from_buffer = fn (id: [*c]git_oid, repo: *git_repository, buffer: *const c_void, len: usize) callconv(.C) c_int;
pub const git_blob_is_binary = fn (blob: *const git_blob) callconv(.C) c_int;
pub const git_blob_dup = fn (out: [*c]*git_blob, source: *git_blob) callconv(.C) c_int;
pub const git_blame_options_init = fn (opts: [*c]git_blame_options, version: c_uint) callconv(.C) c_int;
pub const git_blame_get_hunk_count = fn (blame: *git_blame) callconv(.C) u32;
pub const git_blame_get_hunk_byindex = fn (blame: *git_blame, index: u32) callconv(.C) [*c]const git_blame_hunk;
pub const git_blame_get_hunk_byline = fn (blame: *git_blame, lineno: usize) callconv(.C) [*c]const git_blame_hunk;
pub const git_blame_file = fn (out: [*c]*git_blame, repo: *git_repository, path: [*c]const u8, options: [*c]git_blame_options) callconv(.C) c_int;
pub const git_blame_buffer = fn (out: [*c]*git_blame, reference: *git_blame, buffer: [*c]const u8, buffer_len: usize) callconv(.C) c_int;
pub const git_blame_free = fn (blame: *git_blame) callconv(.C) void;
pub const git_branch_create = fn (out: [*c]*git_reference, repo: *git_repository, branch_name: [*c]const u8, target: *const git_commit, force: c_int) callconv(.C) c_int;
pub const git_branch_create_from_annotated = fn (ref_out: [*c]*git_reference, repository: *git_repository, branch_name: [*c]const u8, commit: *const git_annotated_commit, force: c_int) callconv(.C) c_int;
pub const git_branch_delete = fn (branch: *git_reference) callconv(.C) c_int;
pub const git_branch_iterator_new = fn (out: [*c]*git_branch_iterator, repo: *git_repository, list_flags: git_branch_t) callconv(.C) c_int;
pub const git_branch_next = fn (out: [*c]*git_reference, out_type: [*c]git_branch_t, iter: *git_branch_iterator) callconv(.C) c_int;
pub const git_branch_iterator_free = fn (iter: *git_branch_iterator) callconv(.C) void;
pub const git_branch_move = fn (out: [*c]*git_reference, branch: *git_reference, new_branch_name: [*c]const u8, force: c_int) callconv(.C) c_int;
pub const git_branch_lookup = fn (out: [*c]*git_reference, repo: *git_repository, branch_name: [*c]const u8, branch_type: git_branch_t) callconv(.C) c_int;
pub const git_branch_name = fn (out: [*c][*c]const u8, ref: *const git_reference) callconv(.C) c_int;
pub const git_branch_upstream = fn (out: [*c]*git_reference, branch: *const git_reference) callconv(.C) c_int;
pub const git_branch_set_upstream = fn (branch: *git_reference, branch_name: [*c]const u8) callconv(.C) c_int;
pub const git_branch_upstream_name = fn (out: [*c]git_buf, repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_branch_is_head = fn (branch: *const git_reference) callconv(.C) c_int;
pub const git_branch_is_checked_out = fn (branch: *const git_reference) callconv(.C) c_int;
pub const git_branch_remote_name = fn (out: [*c]git_buf, repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_branch_upstream_remote = fn (buf: [*c]git_buf, repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_branch_upstream_merge = fn (buf: [*c]git_buf, repo: *git_repository, refname: [*c]const u8) callconv(.C) c_int;
pub const git_branch_name_is_valid = fn (valid: [*c]c_int, name: [*c]const u8) callconv(.C) c_int;
pub const git_checkout_options_init = fn (opts: [*c]git_checkout_options, version: c_uint) callconv(.C) c_int;
pub const git_checkout_head = fn (repo: *git_repository, opts: [*c]const git_checkout_options) callconv(.C) c_int;
pub const git_checkout_index = fn (repo: *git_repository, index: *git_index, opts: [*c]const git_checkout_options) callconv(.C) c_int;
pub const git_checkout_tree = fn (repo: *git_repository, treeish: *const git_object, opts: [*c]const git_checkout_options) callconv(.C) c_int;
pub const git_oidarray_dispose = fn (array: [*c]git_oidarray) callconv(.C) void;
pub const git_indexer_options_init = fn (opts: [*c]git_indexer_options, version: c_uint) callconv(.C) c_int;
pub const git_indexer_new = fn (out: [*c]*git_indexer, path: [*c]const u8, mode: c_uint, odb: *git_odb, opts: [*c]git_indexer_options) callconv(.C) c_int;
pub const git_indexer_append = fn (idx: *git_indexer, data: *const c_void, size: usize, stats: [*c]git_indexer_progress) callconv(.C) c_int;
pub const git_indexer_commit = fn (idx: *git_indexer, stats: [*c]git_indexer_progress) callconv(.C) c_int;
pub const git_indexer_hash = fn (idx: *const git_indexer) callconv(.C) [*c]const git_oid;
pub const git_indexer_free = fn (idx: *git_indexer) callconv(.C) void;
pub const git_index_open = fn (out: [*c]*git_index, index_path: [*c]const u8) callconv(.C) c_int;
pub const git_index_new = fn (out: [*c]*git_index) callconv(.C) c_int;
pub const git_index_free = fn (index: *git_index) callconv(.C) void;
pub const git_index_owner = fn (index: *const git_index) callconv(.C) *git_repository;
pub const git_index_caps = fn (index: *const git_index) callconv(.C) c_int;
pub const git_index_set_caps = fn (index: *git_index, caps: c_int) callconv(.C) c_int;
pub const git_index_version = fn (index: *git_index) callconv(.C) c_uint;
pub const git_index_set_version = fn (index: *git_index, version: c_uint) callconv(.C) c_int;
pub const git_index_read = fn (index: *git_index, force: c_int) callconv(.C) c_int;
pub const git_index_write = fn (index: *git_index) callconv(.C) c_int;
pub const git_index_path = fn (index: *const git_index) callconv(.C) [*c]const u8;
pub const git_index_checksum = fn (index: *git_index) callconv(.C) [*c]const git_oid;
pub const git_index_read_tree = fn (index: *git_index, tree: *const git_tree) callconv(.C) c_int;
pub const git_index_write_tree = fn (out: [*c]git_oid, index: ?*git_index) callconv(.C) c_int;
pub const git_index_write_tree_to = fn (out: [*c]git_oid, index: *git_index, repo: *git_repository) callconv(.C) c_int;
pub const git_index_entrycount = fn (index: *const git_index) callconv(.C) usize;
pub const git_index_clear = fn (index: *git_index) callconv(.C) c_int;
pub const git_index_get_byindex = fn (index: *git_index, n: usize) callconv(.C) [*c]const git_index_entry;
pub const git_index_get_bypath = fn (index: *git_index, path: [*c]const u8, stage: c_int) callconv(.C) [*c]const git_index_entry;
pub const git_index_remove = fn (index: *git_index, path: [*c]const u8, stage: c_int) callconv(.C) c_int;
pub const git_index_remove_directory = fn (index: *git_index, dir: [*c]const u8, stage: c_int) callconv(.C) c_int;
pub const git_index_add = fn (index: *git_index, source_entry: [*c]const git_index_entry) callconv(.C) c_int;
pub const git_index_entry_stage = fn (entry: [*c]const git_index_entry) callconv(.C) c_int;
pub const git_index_entry_is_conflict = fn (entry: [*c]const git_index_entry) callconv(.C) c_int;
pub const git_index_iterator_new = fn (iterator_out: [*c]*git_index_iterator, index: *git_index) callconv(.C) c_int;
pub const git_index_iterator_next = fn (out: [*c][*c]const git_index_entry, iterator: *git_index_iterator) callconv(.C) c_int;
pub const git_index_iterator_free = fn (iterator: *git_index_iterator) callconv(.C) void;
pub const git_index_add_bypath = fn (index: *git_index, path: [*c]const u8) callconv(.C) c_int;
pub const git_index_add_from_buffer = fn (index: ?*git_index, entry: [*c]const git_index_entry, buffer: *const c_void, len: usize) callconv(.C) c_int;
pub const git_index_remove_bypath = fn (index: ?*git_index, path: [*c]const u8) callconv(.C) c_int;
pub const git_index_add_all = fn (index: ?*git_index, pathspec: [*c]const git_strarray, flags: c_uint, callback: git_index_matched_path_cb, payload: ?*c_void) callconv(.C) c_int;
pub const git_index_remove_all = fn (index: ?*git_index, pathspec: [*c]const git_strarray, callback: git_index_matched_path_cb, payload: *c_void) callconv(.C) c_int;
pub const git_index_update_all = fn (index: ?*git_index, pathspec: [*c]const git_strarray, callback: git_index_matched_path_cb, payload: *c_void) callconv(.C) c_int;
pub const git_index_find = fn (at_pos: [*c]usize, index: *git_index, path: [*c]const u8) callconv(.C) c_int;
pub const git_index_find_prefix = fn (at_pos: [*c]usize, index: *git_index, prefix: [*c]const u8) callconv(.C) c_int;
pub const git_index_conflict_add = fn (index: *git_index, ancestor_entry: [*c]const git_index_entry, our_entry: [*c]const git_index_entry, their_entry: [*c]const git_index_entry) callconv(.C) c_int;
pub const git_index_conflict_get = fn (ancestor_out: [*c][*c]const git_index_entry, our_out: [*c][*c]const git_index_entry, their_out: [*c][*c]const git_index_entry, index: *git_index, path: [*c]const u8) callconv(.C) c_int;
pub const git_index_conflict_remove = fn (index: *git_index, path: [*c]const u8) callconv(.C) c_int;
pub const git_index_conflict_cleanup = fn (index: *git_index) callconv(.C) c_int;
pub const git_index_has_conflicts = fn (index: *const git_index) callconv(.C) c_int;
pub const git_index_conflict_iterator_new = fn (iterator_out: [*c]*git_index_conflict_iterator, index: *git_index) callconv(.C) c_int;
pub const git_index_conflict_next = fn (ancestor_out: [*c][*c]const git_index_entry, our_out: [*c][*c]const git_index_entry, their_out: [*c][*c]const git_index_entry, iterator: *git_index_conflict_iterator) callconv(.C) c_int;
pub const git_index_conflict_iterator_free = fn (iterator: *git_index_conflict_iterator) callconv(.C) void;
pub const git_merge_file_input_init = fn (opts: [*c]git_merge_file_input, version: c_uint) callconv(.C) c_int;
pub const git_merge_file_options_init = fn (opts: [*c]git_merge_file_options, version: c_uint) callconv(.C) c_int;
pub const git_merge_options_init = fn (opts: [*c]git_merge_options, version: c_uint) callconv(.C) c_int;
pub const git_merge_analysis = fn (analysis_out: [*c]git_merge_analysis_t, preference_out: [*c]git_merge_preference_t, repo: *git_repository, their_heads: [*c]*const git_annotated_commit, their_heads_len: usize) callconv(.C) c_int;
pub const git_merge_analysis_for_ref = fn (analysis_out: [*c]git_merge_analysis_t, preference_out: [*c]git_merge_preference_t, repo: *git_repository, our_ref: *git_reference, their_heads: [*c]*const git_annotated_commit, their_heads_len: usize) callconv(.C) c_int;
pub const git_merge_base = fn (out: [*c]git_oid, repo: *git_repository, one: [*c]const git_oid, two: [*c]const git_oid) callconv(.C) c_int;
pub const git_merge_bases = fn (out: [*c]git_oidarray, repo: *git_repository, one: [*c]const git_oid, two: [*c]const git_oid) callconv(.C) c_int;
pub const git_merge_base_many = fn (out: [*c]git_oid, repo: *git_repository, length: usize, input_array: [*c]const git_oid) callconv(.C) c_int;
pub const git_merge_bases_many = fn (out: [*c]git_oidarray, repo: *git_repository, length: usize, input_array: [*c]const git_oid) callconv(.C) c_int;
pub const git_merge_base_octopus = fn (out: [*c]git_oid, repo: *git_repository, length: usize, input_array: [*c]const git_oid) callconv(.C) c_int;
pub const git_merge_file = fn (out: [*c]git_merge_file_result, ancestor: [*c]const git_merge_file_input, ours: [*c]const git_merge_file_input, theirs: [*c]const git_merge_file_input, opts: [*c]const git_merge_file_options) callconv(.C) c_int;
pub const git_merge_file_from_index = fn (out: [*c]git_merge_file_result, repo: *git_repository, ancestor: [*c]const git_index_entry, ours: [*c]const git_index_entry, theirs: [*c]const git_index_entry, opts: [*c]const git_merge_file_options) callconv(.C) c_int;
pub const git_merge_file_result_free = fn (result: [*c]git_merge_file_result) callconv(.C) void;
pub const git_merge_trees = fn (out: [*c]*git_index, repo: *git_repository, ancestor_tree: *const git_tree, our_tree: *const git_tree, their_tree: *const git_tree, opts: [*c]const git_merge_options) callconv(.C) c_int;
pub const git_merge_commits = fn (out: [*c]*git_index, repo: *git_repository, our_commit: *const git_commit, their_commit: *const git_commit, opts: [*c]const git_merge_options) callconv(.C) c_int;
pub const git_merge = fn (repo: *git_repository, their_heads: [*c]*const git_annotated_commit, their_heads_len: usize, merge_opts: [*c]const git_merge_options, checkout_opts: [*c]const git_checkout_options) callconv(.C) c_int;
pub const git_cherrypick_options_init = fn (opts: [*c]git_cherrypick_options, version: c_uint) callconv(.C) c_int;
pub const git_cherrypick_commit = fn (out: [*c]*git_index, repo: *git_repository, cherrypick_commit: *git_commit, our_commit: *git_commit, mainline: c_uint, merge_options: [*c]const git_merge_options) callconv(.C) c_int;
pub const git_cherrypick = fn (repo: *git_repository, commit: *git_commit, cherrypick_options: [*c]const git_cherrypick_options) callconv(.C) c_int;
pub const git_refspec_parse = fn (refspec: [*c]*git_refspec, input: [*c]const u8, is_fetch: c_int) callconv(.C) c_int;
pub const git_refspec_free = fn (refspec: *git_refspec) callconv(.C) void;
pub const git_refspec_src = fn (refspec: *const git_refspec) callconv(.C) [*c]const u8;
pub const git_refspec_dst = fn (refspec: *const git_refspec) callconv(.C) [*c]const u8;
pub const git_refspec_string = fn (refspec: *const git_refspec) callconv(.C) [*c]const u8;
pub const git_refspec_force = fn (refspec: *const git_refspec) callconv(.C) c_int;
pub const git_refspec_direction = fn (spec: *const git_refspec) callconv(.C) git_direction;
pub const git_refspec_src_matches = fn (refspec: *const git_refspec, refname: [*c]const u8) callconv(.C) c_int;
pub const git_refspec_dst_matches = fn (refspec: *const git_refspec, refname: [*c]const u8) callconv(.C) c_int;
pub const git_refspec_transform = fn (out: [*c]git_buf, spec: *const git_refspec, name: [*c]const u8) callconv(.C) c_int;
pub const git_refspec_rtransform = fn (out: [*c]git_buf, spec: *const git_refspec, name: [*c]const u8) callconv(.C) c_int;
pub const git_credential_free = fn (cred: [*c]git_credential) callconv(.C) void;
pub const git_credential_has_username = fn (cred: [*c]git_credential) callconv(.C) c_int;
pub const git_credential_get_username = fn (cred: [*c]git_credential) callconv(.C) [*c]const u8;
pub const git_credential_userpass_plaintext_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, password: [*c]const u8) callconv(.C) c_int;
pub const git_credential_default_new = fn (out: [*c][*c]git_credential) callconv(.C) c_int;
pub const git_credential_username_new = fn (out: [*c][*c]git_credential, username: [*c]const u8) callconv(.C) c_int;
pub const git_credential_ssh_key_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, publickey: [*c]const u8, privatekey: [*c]const u8, passphrase: [*c]const u8) callconv(.C) c_int;
pub const git_credential_ssh_key_memory_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, publickey: [*c]const u8, privatekey: [*c]const u8, passphrase: [*c]const u8) callconv(.C) c_int;
pub const git_credential_ssh_interactive_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, prompt_callback: git_credential_ssh_interactive_cb, payload: *c_void) callconv(.C) c_int;
pub const git_credential_ssh_key_from_agent = fn (out: [*c][*c]git_credential, username: [*c]const u8) callconv(.C) c_int;
pub const git_credential_ssh_custom_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, publickey: [*c]const u8, publickey_len: usize, sign_callback: git_credential_sign_cb, payload: *c_void) callconv(.C) c_int;
pub const git_packbuilder_new = fn (out: [*c]*git_packbuilder, repo: *git_repository) callconv(.C) c_int;
pub const git_packbuilder_set_threads = fn (pb: *git_packbuilder, n: c_uint) callconv(.C) c_uint;
pub const git_packbuilder_insert = fn (pb: *git_packbuilder, id: [*c]const git_oid, name: [*c]const u8) callconv(.C) c_int;
pub const git_packbuilder_insert_tree = fn (pb: *git_packbuilder, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_packbuilder_insert_commit = fn (pb: *git_packbuilder, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_packbuilder_insert_walk = fn (pb: *git_packbuilder, walk: *git_revwalk) callconv(.C) c_int;
pub const git_packbuilder_insert_recur = fn (pb: *git_packbuilder, id: [*c]const git_oid, name: [*c]const u8) callconv(.C) c_int;
pub const git_packbuilder_write_buf = fn (buf: [*c]git_buf, pb: *git_packbuilder) callconv(.C) c_int;
pub const git_packbuilder_write = fn (pb: *git_packbuilder, path: [*c]const u8, mode: c_uint, progress_cb: git_indexer_progress_cb, progress_cb_payload: *c_void) callconv(.C) c_int;
pub const git_packbuilder_hash = fn (pb: *git_packbuilder) callconv(.C) [*c]const git_oid;
pub const git_packbuilder_foreach = fn (pb: *git_packbuilder, cb: git_packbuilder_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_packbuilder_object_count = fn (pb: *git_packbuilder) callconv(.C) usize;
pub const git_packbuilder_written = fn (pb: *git_packbuilder) callconv(.C) usize;
pub const git_packbuilder_set_callbacks = fn (pb: *git_packbuilder, progress_cb: git_packbuilder_progress, progress_cb_payload: *c_void) callconv(.C) c_int;
pub const git_packbuilder_free = fn (pb: *git_packbuilder) callconv(.C) void;
pub const git_proxy_options_init = fn (opts: [*c]git_proxy_options, version: c_uint) callconv(.C) c_int;
pub const git_remote_create = fn (out: [*c]*git_remote, repo: *git_repository, name: [*c]const u8, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_create_options_init = fn (opts: [*c]git_remote_create_options, version: c_uint) callconv(.C) c_int;
pub const git_remote_create_with_opts = fn (out: [*c]*git_remote, url: [*c]const u8, opts: [*c]const git_remote_create_options) callconv(.C) c_int;
pub const git_remote_create_with_fetchspec = fn (out: [*c]*git_remote, repo: *git_repository, name: [*c]const u8, url: [*c]const u8, fetch: [*c]const u8) callconv(.C) c_int;
pub const git_remote_create_anonymous = fn (out: [*c]*git_remote, repo: *git_repository, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_create_detached = fn (out: [*c]*git_remote, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_lookup = fn (out: [*c]*git_remote, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_remote_dup = fn (dest: [*c]*git_remote, source: *git_remote) callconv(.C) c_int;
pub const git_remote_owner = fn (remote: *const git_remote) callconv(.C) *git_repository;
pub const git_remote_name = fn (remote: *const git_remote) callconv(.C) [*c]const u8;
pub const git_remote_url = fn (remote: *const git_remote) callconv(.C) [*c]const u8;
pub const git_remote_pushurl = fn (remote: *const git_remote) callconv(.C) [*c]const u8;
pub const git_remote_set_url = fn (repo: *git_repository, remote: [*c]const u8, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_set_pushurl = fn (repo: *git_repository, remote: [*c]const u8, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_set_instance_url = fn (remote: *git_remote, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_set_instance_pushurl = fn (remote: *git_remote, url: [*c]const u8) callconv(.C) c_int;
pub const git_remote_add_fetch = fn (repo: *git_repository, remote: [*c]const u8, refspec: [*c]const u8) callconv(.C) c_int;
pub const git_remote_get_fetch_refspecs = fn (array: [*c]git_strarray, remote: *const git_remote) callconv(.C) c_int;
pub const git_remote_add_push = fn (repo: *git_repository, remote: [*c]const u8, refspec: [*c]const u8) callconv(.C) c_int;
pub const git_remote_get_push_refspecs = fn (array: [*c]git_strarray, remote: *const git_remote) callconv(.C) c_int;
pub const git_remote_refspec_count = fn (remote: *const git_remote) callconv(.C) usize;
pub const git_remote_get_refspec = fn (remote: *const git_remote, n: usize) callconv(.C) *const git_refspec;
pub const git_remote_connect = fn (remote: *git_remote, direction: git_direction, callbacks: [*c]const git_remote_callbacks, proxy_opts: [*c]const git_proxy_options, custom_headers: [*c]const git_strarray) callconv(.C) c_int;
pub const git_remote_ls = fn (out: [*c][*c][*c]const git_remote_head, size: [*c]usize, remote: *git_remote) callconv(.C) c_int;
pub const git_remote_connected = fn (remote: *const git_remote) callconv(.C) c_int;
pub const git_remote_stop = fn (remote: *git_remote) callconv(.C) c_int;
pub const git_remote_disconnect = fn (remote: *git_remote) callconv(.C) c_int;
pub const git_remote_free = fn (remote: *git_remote) callconv(.C) void;
pub const git_remote_list = fn (out: [*c]git_strarray, repo: *git_repository) callconv(.C) c_int;
pub const git_remote_init_callbacks = fn (opts: [*c]git_remote_callbacks, version: c_uint) callconv(.C) c_int;
pub const git_fetch_options_init = fn (opts: [*c]git_fetch_options, version: c_uint) callconv(.C) c_int;
pub const git_push_options_init = fn (opts: [*c]git_push_options, version: c_uint) callconv(.C) c_int;
pub const git_remote_download = fn (remote: *git_remote, refspecs: [*c]const git_strarray, opts: [*c]const git_fetch_options) callconv(.C) c_int;
pub const git_remote_upload = fn (remote: *git_remote, refspecs: [*c]const git_strarray, opts: [*c]const git_push_options) callconv(.C) c_int;
pub const git_remote_update_tips = fn (remote: *git_remote, callbacks: [*c]const git_remote_callbacks, update_fetchhead: c_int, download_tags: git_remote_autotag_option_t, reflog_message: [*c]const u8) callconv(.C) c_int;
pub const git_remote_fetch = fn (remote: *git_remote, refspecs: [*c]const git_strarray, opts: [*c]const git_fetch_options, reflog_message: [*c]const u8) callconv(.C) c_int;
pub const git_remote_prune = fn (remote: *git_remote, callbacks: [*c]const git_remote_callbacks) callconv(.C) c_int;
pub const git_remote_push = fn (remote: *git_remote, refspecs: [*c]const git_strarray, opts: [*c]const git_push_options) callconv(.C) c_int;
pub const git_remote_stats = fn (remote: *git_remote) callconv(.C) [*c]const git_indexer_progress;
pub const git_remote_autotag = fn (remote: *const git_remote) callconv(.C) git_remote_autotag_option_t;
pub const git_remote_set_autotag = fn (repo: *git_repository, remote: [*c]const u8, value: git_remote_autotag_option_t) callconv(.C) c_int;
pub const git_remote_prune_refs = fn (remote: *const git_remote) callconv(.C) c_int;
pub const git_remote_rename = fn (problems: [*c]git_strarray, repo: *git_repository, name: [*c]const u8, new_name: [*c]const u8) callconv(.C) c_int;
pub const git_remote_name_is_valid = fn (valid: [*c]c_int, remote_name: [*c]const u8) callconv(.C) c_int;
pub const git_remote_delete = fn (repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_remote_default_branch = fn (out: [*c]git_buf, remote: *git_remote) callconv(.C) c_int;
pub const git_clone_options_init = fn (opts: [*c]git_clone_options, version: c_uint) callconv(.C) c_int;
pub const git_clone = fn (out: *git_repository, url: [*c]const u8, local_path: [*c]const u8, options: [*c]const git_clone_options) callconv(.C) c_int;
pub const git_commit_lookup = fn (commit: [*c]*git_commit, repo: *git_repository, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_commit_lookup_prefix = fn (commit: [*c]*git_commit, repo: *git_repository, id: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_commit_free = fn (commit: *git_commit) callconv(.C) void;
pub const git_commit_id = fn (commit: *const git_commit) callconv(.C) [*c]const git_oid;
pub const git_commit_owner = fn (commit: *const git_commit) callconv(.C) *git_repository;
pub const git_commit_message_encoding = fn (commit: *const git_commit) callconv(.C) [*c]const u8;
pub const git_commit_message = fn (commit: *const git_commit) callconv(.C) [*c]const u8;
pub const git_commit_message_raw = fn (commit: *const git_commit) callconv(.C) [*c]const u8;
pub const git_commit_summary = fn (commit: *git_commit) callconv(.C) [*c]const u8;
pub const git_commit_body = fn (commit: *git_commit) callconv(.C) [*c]const u8;
pub const git_commit_time = fn (commit: *const git_commit) callconv(.C) git_time_t;
pub const git_commit_time_offset = fn (commit: *const git_commit) callconv(.C) c_int;
pub const git_commit_committer = fn (commit: *const git_commit) callconv(.C) [*c]const git_signature;
pub const git_commit_author = fn (commit: *const git_commit) callconv(.C) [*c]const git_signature;
pub const git_commit_committer_with_mailmap = fn (out: [*c]?*git_signature, commit: *const git_commit, mailmap: *const git_mailmap) callconv(.C) c_int;
pub const git_commit_author_with_mailmap = fn (out: [*c]?*git_signature, commit: *const git_commit, mailmap: *const git_mailmap) callconv(.C) c_int;
pub const git_commit_raw_header = fn (commit: *const git_commit) callconv(.C) [*c]const u8;
pub const git_commit_tree = fn (tree_out: [*c]*git_tree, commit: *const git_commit) callconv(.C) c_int;
pub const git_commit_tree_id = fn (commit: *const git_commit) callconv(.C) [*c]const git_oid;
pub const git_commit_parentcount = fn (commit: *const git_commit) callconv(.C) c_uint;
pub const git_commit_parent = fn (out: [*c]*git_commit, commit: *const git_commit, n: c_uint) callconv(.C) c_int;
pub const git_commit_parent_id = fn (commit: *const git_commit, n: c_uint) callconv(.C) [*c]const git_oid;
pub const git_commit_nth_gen_ancestor = fn (ancestor: [*c]*git_commit, commit: *const git_commit, n: c_uint) callconv(.C) c_int;
pub const git_commit_header_field = fn (out: [*c]git_buf, commit: *const git_commit, field: [*c]const u8) callconv(.C) c_int;
pub const git_commit_extract_signature = fn (signature: [*c]git_buf, signed_data: [*c]git_buf, repo: *git_repository, commit_id: [*c]git_oid, field: [*c]const u8) callconv(.C) c_int;
pub const git_commit_create = fn (id: [*c]git_oid, repo: *git_repository, update_ref: [*c]const u8, author: [*c]const git_signature, committer: [*c]const git_signature, message_encoding: [*c]const u8, message: [*c]const u8, tree: *const git_tree, parent_count: usize, parents: [*c]*const git_commit) callconv(.C) c_int;
pub const git_commit_create_v = fn (id: [*c]git_oid, repo: *git_repository, update_ref: [*c]const u8, author: [*c]const git_signature, committer: [*c]const git_signature, message_encoding: [*c]const u8, message: [*c]const u8, tree: *const git_tree, parent_count: usize, ...) callconv(.C) c_int;
pub const git_commit_amend = fn (id: [*c]git_oid, commit_to_amend: *const git_commit, update_ref: [*c]const u8, author: [*c]const git_signature, committer: [*c]const git_signature, message_encoding: [*c]const u8, message: [*c]const u8, tree: *const git_tree) callconv(.C) c_int;
pub const git_commit_create_buffer = fn (out: [*c]git_buf, repo: *git_repository, author: [*c]const git_signature, committer: [*c]const git_signature, message_encoding: [*c]const u8, message: [*c]const u8, tree: *const git_tree, parent_count: usize, parents: [*c]*const git_commit) callconv(.C) c_int;
pub const git_commit_create_with_signature = fn (out: [*c]git_oid, repo: *git_repository, commit_content: [*c]const u8, signature: [*c]const u8, signature_field: [*c]const u8) callconv(.C) c_int;
pub const git_commit_dup = fn (out: [*c]*git_commit, source: *git_commit) callconv(.C) c_int;
pub const git_config_entry_free = fn ([*c]git_config_entry) callconv(.C) void;
pub const git_config_find_global = fn (out: [*c]git_buf) callconv(.C) c_int;
pub const git_config_find_xdg = fn (out: [*c]git_buf) callconv(.C) c_int;
pub const git_config_find_system = fn (out: [*c]git_buf) callconv(.C) c_int;
pub const git_config_find_programdata = fn (out: [*c]git_buf) callconv(.C) c_int;
pub const git_config_open_default = fn (out: [*c]*git_config) callconv(.C) c_int;
pub const git_config_new = fn (out: [*c]*git_config) callconv(.C) c_int;
pub const git_config_add_file_ondisk = fn (cfg: *git_config, path: [*c]const u8, level: git_config_level_t, repo: *const git_repository, force: c_int) callconv(.C) c_int;
pub const git_config_open_ondisk = fn (out: [*c]*git_config, path: [*c]const u8) callconv(.C) c_int;
pub const git_config_open_level = fn (out: [*c]*git_config, parent: *const git_config, level: git_config_level_t) callconv(.C) c_int;
pub const git_config_open_global = fn (out: [*c]*git_config, config: *git_config) callconv(.C) c_int;
pub const git_config_snapshot = fn (out: [*c]*git_config, config: *git_config) callconv(.C) c_int;
pub const git_config_free = fn (cfg: *git_config) callconv(.C) void;
pub const git_config_get_entry = fn (out: [*c][*c]git_config_entry, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_int32 = fn (out: [*c]i32, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_int64 = fn (out: [*c]i64, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_bool = fn (out: [*c]c_int, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_path = fn (out: [*c]git_buf, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_string = fn (out: [*c][*c]const u8, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_string_buf = fn (out: [*c]git_buf, cfg: *const git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_get_multivar_foreach = fn (cfg: *const git_config, name: [*c]const u8, regexp: [*c]const u8, callback: git_config_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_config_multivar_iterator_new = fn (out: [*c]*git_config_iterator, cfg: *const git_config, name: [*c]const u8, regexp: [*c]const u8) callconv(.C) c_int;
pub const git_config_next = fn (entry: [*c][*c]git_config_entry, iter: *git_config_iterator) callconv(.C) c_int;
pub const git_config_iterator_free = fn (iter: *git_config_iterator) callconv(.C) void;
pub const git_config_set_int32 = fn (cfg: *git_config, name: [*c]const u8, value: i32) callconv(.C) c_int;
pub const git_config_set_int64 = fn (cfg: *git_config, name: [*c]const u8, value: i64) callconv(.C) c_int;
pub const git_config_set_bool = fn (cfg: *git_config, name: [*c]const u8, value: c_int) callconv(.C) c_int;
pub const git_config_set_string = fn (cfg: *git_config, name: [*c]const u8, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_set_multivar = fn (cfg: *git_config, name: [*c]const u8, regexp: [*c]const u8, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_delete_entry = fn (cfg: *git_config, name: [*c]const u8) callconv(.C) c_int;
pub const git_config_delete_multivar = fn (cfg: *git_config, name: [*c]const u8, regexp: [*c]const u8) callconv(.C) c_int;
pub const git_config_foreach = fn (cfg: *const git_config, callback: git_config_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_config_iterator_new = fn (out: [*c]*git_config_iterator, cfg: *const git_config) callconv(.C) c_int;
pub const git_config_iterator_glob_new = fn (out: [*c]*git_config_iterator, cfg: *const git_config, regexp: [*c]const u8) callconv(.C) c_int;
pub const git_config_foreach_match = fn (cfg: *const git_config, regexp: [*c]const u8, callback: git_config_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_config_get_mapped = fn (out: [*c]c_int, cfg: *const git_config, name: [*c]const u8, maps: [*c]const git_configmap, map_n: usize) callconv(.C) c_int;
pub const git_config_lookup_map_value = fn (out: [*c]c_int, maps: [*c]const git_configmap, map_n: usize, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_parse_bool = fn (out: [*c]c_int, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_parse_int32 = fn (out: [*c]i32, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_parse_int64 = fn (out: [*c]i64, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_parse_path = fn (out: [*c]git_buf, value: [*c]const u8) callconv(.C) c_int;
pub const git_config_backend_foreach_match = fn (backend: *git_config_backend, regexp: [*c]const u8, callback: git_config_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_config_lock = fn (tx: [*c]*git_transaction, cfg: *git_config) callconv(.C) c_int;
pub const git_describe_options_init = fn (opts: [*c]git_describe_options, version: c_uint) callconv(.C) c_int;
pub const git_describe_format_options_init = fn (opts: [*c]git_describe_format_options, version: c_uint) callconv(.C) c_int;
pub const git_describe_commit = fn (result: [*c]*git_describe_result, committish: *git_object, opts: [*c]git_describe_options) callconv(.C) c_int;
pub const git_describe_workdir = fn (out: [*c]*git_describe_result, repo: *git_repository, opts: [*c]git_describe_options) callconv(.C) c_int;
pub const git_describe_format = fn (out: [*c]git_buf, result: *const git_describe_result, opts: [*c]const git_describe_format_options) callconv(.C) c_int;
pub const git_describe_result_free = fn (result: *git_describe_result) callconv(.C) void;
pub const git_error_last = fn () callconv(.C) [*c]const git_error;
pub const git_error_clear = fn () callconv(.C) void;
pub const git_error_set_str = fn (error_class: c_int, string: [*c]const u8) callconv(.C) c_int;
pub const git_error_set_oom = fn () callconv(.C) void;
pub const git_filter_list_load = fn (filters: [*c]*git_filter_list, repo: *git_repository, blob: *git_blob, path: [*c]const u8, mode: git_filter_mode_t, flags: u32) callconv(.C) c_int;
pub const git_filter_list_load_ext = fn (filters: [*c]*git_filter_list, repo: *git_repository, blob: *git_blob, path: [*c]const u8, mode: git_filter_mode_t, opts: [*c]git_filter_options) callconv(.C) c_int;
pub const git_filter_list_contains = fn (filters: *git_filter_list, name: [*c]const u8) callconv(.C) c_int;
pub const git_filter_list_apply_to_buffer = fn (out: [*c]git_buf, filters: *git_filter_list, in: [*c]const u8, in_len: usize) callconv(.C) c_int;
pub const git_filter_list_apply_to_file = fn (out: [*c]git_buf, filters: *git_filter_list, repo: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_filter_list_apply_to_blob = fn (out: [*c]git_buf, filters: *git_filter_list, blob: *git_blob) callconv(.C) c_int;
pub const git_filter_list_stream_buffer = fn (filters: *git_filter_list, buffer: [*c]const u8, len: usize, target: [*c]git_writestream) callconv(.C) c_int;
pub const git_filter_list_stream_file = fn (filters: *git_filter_list, repo: *git_repository, path: [*c]const u8, target: [*c]git_writestream) callconv(.C) c_int;
pub const git_filter_list_stream_blob = fn (filters: *git_filter_list, blob: *git_blob, target: [*c]git_writestream) callconv(.C) c_int;
pub const git_filter_list_free = fn (filters: *git_filter_list) callconv(.C) void;
pub const git_rebase_options_init = fn (opts: [*c]git_rebase_options, version: c_uint) callconv(.C) c_int;
pub const git_rebase_init = fn (out: [*c]*git_rebase, repo: *git_repository, branch: *const git_annotated_commit, upstream: *const git_annotated_commit, onto: *const git_annotated_commit, opts: [*c]const git_rebase_options) callconv(.C) c_int;
pub const git_rebase_open = fn (out: [*c]*git_rebase, repo: *git_repository, opts: [*c]const git_rebase_options) callconv(.C) c_int;
pub const git_rebase_orig_head_name = fn (rebase: *git_rebase) callconv(.C) [*c]const u8;
pub const git_rebase_orig_head_id = fn (rebase: *git_rebase) callconv(.C) [*c]const git_oid;
pub const git_rebase_onto_name = fn (rebase: *git_rebase) callconv(.C) [*c]const u8;
pub const git_rebase_onto_id = fn (rebase: *git_rebase) callconv(.C) [*c]const git_oid;
pub const git_rebase_operation_entrycount = fn (rebase: *git_rebase) callconv(.C) usize;
pub const git_rebase_operation_current = fn (rebase: *git_rebase) callconv(.C) usize;
pub const git_rebase_operation_byindex = fn (rebase: *git_rebase, idx: usize) callconv(.C) [*c]git_rebase_operation;
pub const git_rebase_next = fn (operation: [*c][*c]git_rebase_operation, rebase: *git_rebase) callconv(.C) c_int;
pub const git_rebase_inmemory_index = fn (index: [*c]*git_index, rebase: *git_rebase) callconv(.C) c_int;
pub const git_rebase_commit = fn (id: [*c]git_oid, rebase: *git_rebase, author: [*c]const git_signature, committer: [*c]const git_signature, message_encoding: [*c]const u8, message: [*c]const u8) callconv(.C) c_int;
pub const git_rebase_abort = fn (rebase: *git_rebase) callconv(.C) c_int;
pub const git_rebase_finish = fn (rebase: *git_rebase, signature: [*c]const git_signature) callconv(.C) c_int;
pub const git_rebase_free = fn (rebase: *git_rebase) callconv(.C) void;
pub const git_trace_set = fn (level: git_trace_level_t, cb: git_trace_cb) callconv(.C) c_int;
pub const git_revert_options_init = fn (opts: [*c]git_revert_options, version: c_uint) callconv(.C) c_int;
pub const git_revert_commit = fn (out: [*c]*git_index, repo: *git_repository, revert_commit: *git_commit, our_commit: *git_commit, mainline: c_uint, merge_options: [*c]const git_merge_options) callconv(.C) c_int;
pub const git_revert = fn (repo: *git_repository, commit: *git_commit, given_opts: [*c]const git_revert_options) callconv(.C) c_int;
pub const git_revparse_single = fn (out: [*c]*git_object, repo: *git_repository, spec: [*c]const u8) callconv(.C) c_int;
pub const git_revparse_ext = fn (object_out: [*c]*git_object, reference_out: [*c]*git_reference, repo: *git_repository, spec: [*c]const u8) callconv(.C) c_int;
pub const git_revparse = fn (revspec: [*c]git_revspec, repo: *git_repository, spec: [*c]const u8) callconv(.C) c_int;
pub const git_stash_save = fn (out: [*c]git_oid, repo: *git_repository, stasher: [*c]const git_signature, message: [*c]const u8, flags: u32) callconv(.C) c_int;
pub const git_stash_apply_options_init = fn (opts: [*c]git_stash_apply_options, version: c_uint) callconv(.C) c_int;
pub const git_stash_apply = fn (repo: *git_repository, index: usize, options: [*c]const git_stash_apply_options) callconv(.C) c_int;
pub const git_stash_foreach = fn (repo: *git_repository, callback: git_stash_cb, payload: *c_void) callconv(.C) c_int;
pub const git_stash_drop = fn (repo: *git_repository, index: usize) callconv(.C) c_int;
pub const git_stash_pop = fn (repo: *git_repository, index: usize, options: [*c]const git_stash_apply_options) callconv(.C) c_int;
pub const git_status_options_init = fn (opts: [*c]git_status_options, version: c_uint) callconv(.C) c_int;
pub const git_status_foreach = fn (repo: *git_repository, callback: git_status_cb, payload: *c_void) callconv(.C) c_int;
pub const git_status_foreach_ext = fn (repo: *git_repository, opts: [*c]const git_status_options, callback: git_status_cb, payload: *c_void) callconv(.C) c_int;
pub const git_status_file = fn (status_flags: [*c]c_uint, repo: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_status_list_new = fn (out: [*c]*git_status_list, repo: *git_repository, opts: [*c]const git_status_options) callconv(.C) c_int;
pub const git_status_list_entrycount = fn (statuslist: *git_status_list) callconv(.C) usize;
pub const git_status_byindex = fn (statuslist: *git_status_list, idx: usize) callconv(.C) [*c]const git_status_entry;
pub const git_status_list_free = fn (statuslist: *git_status_list) callconv(.C) void;
pub const git_status_should_ignore = fn (ignored: [*c]c_int, repo: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_submodule_update_options_init = fn (opts: [*c]git_submodule_update_options, version: c_uint) callconv(.C) c_int;
pub const git_submodule_update = fn (submodule: *git_submodule, init: c_int, options: [*c]git_submodule_update_options) callconv(.C) c_int;
pub const git_submodule_lookup = fn (out: [*c]*git_submodule, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_submodule_dup = fn (out: [*c]*git_submodule, source: *git_submodule) callconv(.C) c_int;
pub const git_submodule_free = fn (submodule: *git_submodule) callconv(.C) void;
pub const git_submodule_foreach = fn (repo: *git_repository, callback: git_submodule_cb, payload: *c_void) callconv(.C) c_int;
pub const git_submodule_add_setup = fn (out: [*c]*git_submodule, repo: *git_repository, url: [*c]const u8, path: [*c]const u8, use_gitlink: c_int) callconv(.C) c_int;
pub const git_submodule_clone = fn (out: *git_repository, submodule: *git_submodule, opts: [*c]const git_submodule_update_options) callconv(.C) c_int;
pub const git_submodule_add_finalize = fn (submodule: *git_submodule) callconv(.C) c_int;
pub const git_submodule_add_to_index = fn (submodule: *git_submodule, write_index: c_int) callconv(.C) c_int;
pub const git_submodule_owner = fn (submodule: *git_submodule) callconv(.C) *git_repository;
pub const git_submodule_name = fn (submodule: *git_submodule) callconv(.C) [*c]const u8;
pub const git_submodule_path = fn (submodule: *git_submodule) callconv(.C) [*c]const u8;
pub const git_submodule_url = fn (submodule: *git_submodule) callconv(.C) [*c]const u8;
pub const git_submodule_resolve_url = fn (out: [*c]git_buf, repo: *git_repository, url: [*c]const u8) callconv(.C) c_int;
pub const git_submodule_branch = fn (submodule: *git_submodule) callconv(.C) [*c]const u8;
pub const git_submodule_set_branch = fn (repo: *git_repository, name: [*c]const u8, branch: [*c]const u8) callconv(.C) c_int;
pub const git_submodule_set_url = fn (repo: *git_repository, name: [*c]const u8, url: [*c]const u8) callconv(.C) c_int;
pub const git_submodule_index_id = fn (submodule: *git_submodule) callconv(.C) [*c]const git_oid;
pub const git_submodule_head_id = fn (submodule: *git_submodule) callconv(.C) [*c]const git_oid;
pub const git_submodule_wd_id = fn (submodule: *git_submodule) callconv(.C) [*c]const git_oid;
pub const git_submodule_ignore = fn (submodule: *git_submodule) callconv(.C) git_submodule_ignore_t;
pub const git_submodule_set_ignore = fn (repo: *git_repository, name: [*c]const u8, ignore: git_submodule_ignore_t) callconv(.C) c_int;
pub const git_submodule_update_strategy = fn (submodule: *git_submodule) callconv(.C) git_submodule_update_t;
pub const git_submodule_set_update = fn (repo: *git_repository, name: [*c]const u8, update: git_submodule_update_t) callconv(.C) c_int;
pub const git_submodule_fetch_recurse_submodules = fn (submodule: *git_submodule) callconv(.C) git_submodule_recurse_t;
pub const git_submodule_set_fetch_recurse_submodules = fn (repo: *git_repository, name: [*c]const u8, fetch_recurse_submodules: git_submodule_recurse_t) callconv(.C) c_int;
pub const git_submodule_init = fn (submodule: *git_submodule, overwrite: c_int) callconv(.C) c_int;
pub const git_submodule_repo_init = fn (out: *git_repository, sm: *const git_submodule, use_gitlink: c_int) callconv(.C) c_int;
pub const git_submodule_sync = fn (submodule: *git_submodule) callconv(.C) c_int;
pub const git_submodule_open = fn (repo: *git_repository, submodule: *git_submodule) callconv(.C) c_int;
pub const git_submodule_reload = fn (submodule: *git_submodule, force: c_int) callconv(.C) c_int;
pub const git_submodule_status = fn (status: [*c]c_uint, repo: *git_repository, name: [*c]const u8, ignore: git_submodule_ignore_t) callconv(.C) c_int;
pub const git_submodule_location = fn (location_status: [*c]c_uint, submodule: *git_submodule) callconv(.C) c_int;
pub const git_worktree_list = fn (out: [*c]git_strarray, repo: *git_repository) callconv(.C) c_int;
pub const git_worktree_lookup = fn (out: [*c]*git_worktree, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_worktree_open_from_repository = fn (out: [*c]*git_worktree, repo: *git_repository) callconv(.C) c_int;
pub const git_worktree_free = fn (wt: *git_worktree) callconv(.C) void;
pub const git_worktree_validate = fn (wt: *const git_worktree) callconv(.C) c_int;
pub const git_worktree_add_options_init = fn (opts: [*c]git_worktree_add_options, version: c_uint) callconv(.C) c_int;
pub const git_worktree_add = fn (out: [*c]*git_worktree, repo: *git_repository, name: [*c]const u8, path: [*c]const u8, opts: [*c]const git_worktree_add_options) callconv(.C) c_int;
pub const git_worktree_lock = fn (wt: *git_worktree, reason: [*c]const u8) callconv(.C) c_int;
pub const git_worktree_unlock = fn (wt: *git_worktree) callconv(.C) c_int;
pub const git_worktree_is_locked = fn (reason: [*c]git_buf, wt: *const git_worktree) callconv(.C) c_int;
pub const git_worktree_name = fn (wt: *const git_worktree) callconv(.C) [*c]const u8;
pub const git_worktree_path = fn (wt: *const git_worktree) callconv(.C) [*c]const u8;
pub const git_worktree_prune_options_init = fn (opts: [*c]git_worktree_prune_options, version: c_uint) callconv(.C) c_int;
pub const git_worktree_is_prunable = fn (wt: *git_worktree, opts: [*c]git_worktree_prune_options) callconv(.C) c_int;
pub const git_worktree_prune = fn (wt: *git_worktree, opts: [*c]git_worktree_prune_options) callconv(.C) c_int;
pub const git_credential_userpass = fn (out: [*c][*c]git_credential, url: [*c]const u8, user_from_url: [*c]const u8, allowed_types: c_uint, payload: *c_void) callconv(.C) c_int;
pub const git_blob_create_fromworkdir = fn (id: [*c]git_oid, repo: *git_repository, relative_path: [*c]const u8) callconv(.C) c_int;
pub const git_blob_create_fromdisk = fn (id: [*c]git_oid, repo: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_blob_create_fromstream = fn (out: [*c][*c]git_writestream, repo: *git_repository, hintpath: [*c]const u8) callconv(.C) c_int;
pub const git_blob_create_fromstream_commit = fn (out: [*c]git_oid, stream: [*c]git_writestream) callconv(.C) c_int;
pub const git_blob_create_frombuffer = fn (id: [*c]git_oid, repo: *git_repository, buffer: *const c_void, len: usize) callconv(.C) c_int;
pub const git_blob_filtered_content = fn (out: [*c]git_buf, blob: *git_blob, as_path: [*c]const u8, check_for_binary_data: c_int) callconv(.C) c_int;
pub const git_filter_list_stream_data = fn (filters: *git_filter_list, data: [*c]git_buf, target: [*c]git_writestream) callconv(.C) c_int;
pub const git_filter_list_apply_to_data = fn (out: [*c]git_buf, filters: *git_filter_list, in: [*c]git_buf) callconv(.C) c_int;
pub const git_treebuilder_write_with_buffer = fn (oid: [*c]git_oid, bld: *git_treebuilder, tree: [*c]git_buf) callconv(.C) c_int;
pub const git_buf_free = fn (buffer: [*c]git_buf) callconv(.C) void;
pub const git_diff_format_email = fn (out: [*c]git_buf, diff: *git_diff, opts: [*c]const git_diff_format_email_options) callconv(.C) c_int;
pub const git_diff_commit_as_email = fn (out: [*c]git_buf, repo: *git_repository, commit: *git_commit, patch_no: usize, total_patches: usize, flags: u32, diff_opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_diff_format_email_options_init = fn (opts: [*c]git_diff_format_email_options, version: c_uint) callconv(.C) c_int;
pub const giterr_last = fn () callconv(.C) [*c]const git_error;
pub const giterr_clear = fn () callconv(.C) void;
pub const giterr_set_str = fn (error_class: c_int, string: [*c]const u8) callconv(.C) void;
pub const giterr_set_oom = fn () callconv(.C) void;
pub const git_index_add_frombuffer = fn (index: *git_index, entry: [*c]const git_index_entry, buffer: *const c_void, len: usize) callconv(.C) c_int;
pub const git_object__size = fn (@"type": git_object_t) callconv(.C) usize;
pub const git_remote_is_valid_name = fn (remote_name: [*c]const u8) callconv(.C) c_int;
pub const git_reference_is_valid_name = fn (refname: [*c]const u8) callconv(.C) c_int;
pub const git_tag_create_frombuffer = fn (oid: [*c]git_oid, repo: *git_repository, buffer: [*c]const u8, force: c_int) callconv(.C) c_int;
pub const git_cred_free = fn (cred: [*c]git_credential) callconv(.C) void;
pub const git_cred_has_username = fn (cred: [*c]git_credential) callconv(.C) c_int;
pub const git_cred_get_username = fn (cred: [*c]git_credential) callconv(.C) [*c]const u8;
pub const git_cred_userpass_plaintext_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, password: [*c]const u8) callconv(.C) c_int;
pub const git_cred_default_new = fn (out: [*c][*c]git_credential) callconv(.C) c_int;
pub const git_cred_username_new = fn (out: [*c][*c]git_credential, username: [*c]const u8) callconv(.C) c_int;
pub const git_cred_ssh_key_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, publickey: [*c]const u8, privatekey: [*c]const u8, passphrase: [*c]const u8) callconv(.C) c_int;
pub const git_cred_ssh_key_memory_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, publickey: [*c]const u8, privatekey: [*c]const u8, passphrase: [*c]const u8) callconv(.C) c_int;
pub const git_cred_ssh_interactive_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, prompt_callback: git_credential_ssh_interactive_cb, payload: *c_void) callconv(.C) c_int;
pub const git_cred_ssh_key_from_agent = fn (out: [*c][*c]git_credential, username: [*c]const u8) callconv(.C) c_int;
pub const git_cred_ssh_custom_new = fn (out: [*c][*c]git_credential, username: [*c]const u8, publickey: [*c]const u8, publickey_len: usize, sign_callback: git_credential_sign_cb, payload: *c_void) callconv(.C) c_int;
pub const git_cred_userpass = fn (out: [*c][*c]git_credential, url: [*c]const u8, user_from_url: [*c]const u8, allowed_types: c_uint, payload: *c_void) callconv(.C) c_int;
pub const git_oid_iszero = fn (id: [*c]const git_oid) callconv(.C) c_int;
pub const git_oidarray_free = fn (array: [*c]git_oidarray) callconv(.C) void;
pub const git_strarray_free = fn (array: [*c]git_strarray) callconv(.C) void;
pub const git_blame_init_options = fn (opts: [*c]git_blame_options, version: c_uint) callconv(.C) c_int;
pub const git_checkout_init_options = fn (opts: [*c]git_checkout_options, version: c_uint) callconv(.C) c_int;
pub const git_cherrypick_init_options = fn (opts: [*c]git_cherrypick_options, version: c_uint) callconv(.C) c_int;
pub const git_clone_init_options = fn (opts: [*c]git_clone_options, version: c_uint) callconv(.C) c_int;
pub const git_describe_init_options = fn (opts: [*c]git_describe_options, version: c_uint) callconv(.C) c_int;
pub const git_describe_init_format_options = fn (opts: [*c]git_describe_format_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_init_options = fn (opts: [*c]git_diff_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_find_init_options = fn (opts: [*c]git_diff_find_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_format_email_init_options = fn (opts: [*c]git_diff_format_email_options, version: c_uint) callconv(.C) c_int;
pub const git_diff_patchid_init_options = fn (opts: [*c]git_diff_patchid_options, version: c_uint) callconv(.C) c_int;
pub const git_fetch_init_options = fn (opts: [*c]git_fetch_options, version: c_uint) callconv(.C) c_int;
pub const git_indexer_init_options = fn (opts: [*c]git_indexer_options, version: c_uint) callconv(.C) c_int;
pub const git_merge_init_options = fn (opts: [*c]git_merge_options, version: c_uint) callconv(.C) c_int;
pub const git_merge_file_init_input = fn (input: [*c]git_merge_file_input, version: c_uint) callconv(.C) c_int;
pub const git_merge_file_init_options = fn (opts: [*c]git_merge_file_options, version: c_uint) callconv(.C) c_int;
pub const git_proxy_init_options = fn (opts: [*c]git_proxy_options, version: c_uint) callconv(.C) c_int;
pub const git_push_init_options = fn (opts: [*c]git_push_options, version: c_uint) callconv(.C) c_int;
pub const git_rebase_init_options = fn (opts: [*c]git_rebase_options, version: c_uint) callconv(.C) c_int;
pub const git_remote_create_init_options = fn (opts: [*c]git_remote_create_options, version: c_uint) callconv(.C) c_int;
pub const git_repository_init_init_options = fn (opts: ?*git_repository_init_options, version: c_uint) callconv(.C) c_int;
pub const git_revert_init_options = fn (opts: [*c]git_revert_options, version: c_uint) callconv(.C) c_int;
pub const git_stash_apply_init_options = fn (opts: [*c]git_stash_apply_options, version: c_uint) callconv(.C) c_int;
pub const git_status_init_options = fn (opts: [*c]git_status_options, version: c_uint) callconv(.C) c_int;
pub const git_submodule_update_init_options = fn (opts: [*c]git_submodule_update_options, version: c_uint) callconv(.C) c_int;
pub const git_worktree_add_init_options = fn (opts: [*c]git_worktree_add_options, version: c_uint) callconv(.C) c_int;
pub const git_worktree_prune_init_options = fn (opts: [*c]git_worktree_prune_options, version: c_uint) callconv(.C) c_int;
pub const git_email_create_from_diff = fn (out: [*c]git_buf, diff: *git_diff, patch_idx: usize, patch_count: usize, commit_id: [*c]const git_oid, summary: [*c]const u8, body: [*c]const u8, author: [*c]const git_signature, opts: [*c]const git_email_create_options) callconv(.C) c_int;
pub const git_email_create_from_commit = fn (out: [*c]git_buf, commit: *git_commit, opts: [*c]const git_email_create_options) callconv(.C) c_int;
pub const git_libgit2_init = fn () callconv(.C) c_int;
pub const git_libgit2_shutdown = fn () callconv(.C) c_int;
pub const git_graph_ahead_behind = fn (ahead: [*c]usize, behind: [*c]usize, repo: *git_repository, local: [*c]const git_oid, upstream: [*c]const git_oid) callconv(.C) c_int;
pub const git_graph_descendant_of = fn (repo: *git_repository, commit: [*c]const git_oid, ancestor: [*c]const git_oid) callconv(.C) c_int;
pub const git_graph_reachable_from_any = fn (repo: *git_repository, commit: [*c]const git_oid, descendant_array: [*c]const git_oid, length: usize) callconv(.C) c_int;
pub const git_ignore_add_rule = fn (repo: *git_repository, rules: [*c]const u8) callconv(.C) c_int;
pub const git_ignore_clear_internal_rules = fn (repo: *git_repository) callconv(.C) c_int;
pub const git_ignore_path_is_ignored = fn (ignored: [*c]c_int, repo: *git_repository, path: [*c]const u8) callconv(.C) c_int;
pub const git_mailmap_new = fn (out: [*c]*git_mailmap) callconv(.C) c_int;
pub const git_mailmap_free = fn (mm: *git_mailmap) callconv(.C) void;
pub const git_mailmap_add_entry = fn (mm: *git_mailmap, real_name: [*c]const u8, real_email: [*c]const u8, replace_name: [*c]const u8, replace_email: [*c]const u8) callconv(.C) c_int;
pub const git_mailmap_from_buffer = fn (out: [*c]*git_mailmap, buf: [*c]const u8, len: usize) callconv(.C) c_int;
pub const git_mailmap_from_repository = fn (out: [*c]*git_mailmap, repo: *git_repository) callconv(.C) c_int;
pub const git_mailmap_resolve = fn (real_name: [*c][*c]const u8, real_email: [*c][*c]const u8, mm: *const git_mailmap, name: [*c]const u8, email: [*c]const u8) callconv(.C) c_int;
pub const git_mailmap_resolve_signature = fn (out: [*c]?*git_signature, mm: *const git_mailmap, sig: [*c]const git_signature) callconv(.C) c_int;
pub const git_message_prettify = fn (out: [*c]git_buf, message: [*c]const u8, strip_comments: c_int, comment_char: u8) callconv(.C) c_int;
pub const git_message_trailers = fn (arr: [*c]git_message_trailer_array, message: [*c]const u8) callconv(.C) c_int;
pub const git_message_trailer_array_free = fn (arr: [*c]git_message_trailer_array) callconv(.C) void;
pub const git_note_iterator_new = fn (out: [*c]*git_note_iterator, repo: *git_repository, notes_ref: [*c]const u8) callconv(.C) c_int;
pub const git_note_commit_iterator_new = fn (out: [*c]*git_note_iterator, notes_commit: *git_commit) callconv(.C) c_int;
pub const git_note_iterator_free = fn (it: *git_note_iterator) callconv(.C) void;
pub const git_note_next = fn (note_id: [*c]git_oid, annotated_id: [*c]git_oid, it: *git_note_iterator) callconv(.C) c_int;
pub const git_note_read = fn (out: [*c]*git_note, repo: *git_repository, notes_ref: [*c]const u8, oid: [*c]const git_oid) callconv(.C) c_int;
pub const git_note_commit_read = fn (out: [*c]*git_note, repo: *git_repository, notes_commit: *git_commit, oid: [*c]const git_oid) callconv(.C) c_int;
pub const git_note_author = fn (note: *const git_note) callconv(.C) [*c]const git_signature;
pub const git_note_committer = fn (note: *const git_note) callconv(.C) [*c]const git_signature;
pub const git_note_message = fn (note: *const git_note) callconv(.C) [*c]const u8;
pub const git_note_id = fn (note: *const git_note) callconv(.C) [*c]const git_oid;
pub const git_note_create = fn (out: [*c]git_oid, repo: *git_repository, notes_ref: [*c]const u8, author: [*c]const git_signature, committer: [*c]const git_signature, oid: [*c]const git_oid, note: [*c]const u8, force: c_int) callconv(.C) c_int;
pub const git_note_commit_create = fn (notes_commit_out: [*c]git_oid, notes_blob_out: [*c]git_oid, repo: *git_repository, parent: *git_commit, author: [*c]const git_signature, committer: [*c]const git_signature, oid: [*c]const git_oid, note: [*c]const u8, allow_note_overwrite: c_int) callconv(.C) c_int;
pub const git_note_remove = fn (repo: *git_repository, notes_ref: [*c]const u8, author: [*c]const git_signature, committer: [*c]const git_signature, oid: [*c]const git_oid) callconv(.C) c_int;
pub const git_note_commit_remove = fn (notes_commit_out: [*c]git_oid, repo: *git_repository, notes_commit: *git_commit, author: [*c]const git_signature, committer: [*c]const git_signature, oid: [*c]const git_oid) callconv(.C) c_int;
pub const git_note_free = fn (note: *git_note) callconv(.C) void;
pub const git_note_default_ref = fn (out: [*c]git_buf, repo: *git_repository) callconv(.C) c_int;
pub const git_note_foreach = fn (repo: *git_repository, notes_ref: [*c]const u8, note_cb: git_note_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_odb_new = fn (out: [*c]*git_odb) callconv(.C) c_int;
pub const git_odb_open = fn (out: [*c]*git_odb, objects_dir: [*c]const u8) callconv(.C) c_int;
pub const git_odb_add_disk_alternate = fn (odb: *git_odb, path: [*c]const u8) callconv(.C) c_int;
pub const git_odb_free = fn (db: *git_odb) callconv(.C) void;
pub const git_odb_read = fn (out: [*c]*git_odb_object, db: *git_odb, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_odb_read_prefix = fn (out: [*c]*git_odb_object, db: *git_odb, short_id: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_odb_read_header = fn (len_out: [*c]usize, type_out: [*c]git_object_t, db: *git_odb, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_odb_exists = fn (db: *git_odb, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_odb_exists_prefix = fn (out: [*c]git_oid, db: *git_odb, short_id: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_odb_expand_ids = fn (db: *git_odb, ids: [*c]git_odb_expand_id, count: usize) callconv(.C) c_int;
pub const git_odb_refresh = fn (db: *struct_git_odb) callconv(.C) c_int;
pub const git_odb_foreach = fn (db: *git_odb, cb: git_odb_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_odb_write = fn (out: [*c]git_oid, odb: *git_odb, data: *const c_void, len: usize, @"type": git_object_t) callconv(.C) c_int;
pub const git_odb_open_wstream = fn (out: [*c][*c]git_odb_stream, db: *git_odb, size: git_object_size_t, @"type": git_object_t) callconv(.C) c_int;
pub const git_odb_stream_write = fn (stream: [*c]git_odb_stream, buffer: [*c]const u8, len: usize) callconv(.C) c_int;
pub const git_odb_stream_finalize_write = fn (out: [*c]git_oid, stream: [*c]git_odb_stream) callconv(.C) c_int;
pub const git_odb_stream_read = fn (stream: [*c]git_odb_stream, buffer: [*c]u8, len: usize) callconv(.C) c_int;
pub const git_odb_stream_free = fn (stream: [*c]git_odb_stream) callconv(.C) void;
pub const git_odb_open_rstream = fn (out: [*c][*c]git_odb_stream, len: [*c]usize, @"type": [*c]git_object_t, db: *git_odb, oid: [*c]const git_oid) callconv(.C) c_int;
pub const git_odb_write_pack = fn (out: [*c][*c]git_odb_writepack, db: *git_odb, progress_cb: git_indexer_progress_cb, progress_payload: *c_void) callconv(.C) c_int;
pub const git_odb_write_multi_pack_index = fn (db: *git_odb) callconv(.C) c_int;
pub const git_odb_hash = fn (out: [*c]git_oid, data: *const c_void, len: usize, @"type": git_object_t) callconv(.C) c_int;
pub const git_odb_hashfile = fn (out: [*c]git_oid, path: [*c]const u8, @"type": git_object_t) callconv(.C) c_int;
pub const git_odb_object_dup = fn (dest: [*c]*git_odb_object, source: *git_odb_object) callconv(.C) c_int;
pub const git_odb_object_free = fn (object: *git_odb_object) callconv(.C) void;
pub const git_odb_object_id = fn (object: *git_odb_object) callconv(.C) [*c]const git_oid;
pub const git_odb_object_data = fn (object: *git_odb_object) callconv(.C) *const c_void;
pub const git_odb_object_size = fn (object: *git_odb_object) callconv(.C) usize;
pub const git_odb_object_type = fn (object: *git_odb_object) callconv(.C) git_object_t;
pub const git_odb_add_backend = fn (odb: *git_odb, backend: *git_odb_backend, priority: c_int) callconv(.C) c_int;
pub const git_odb_add_alternate = fn (odb: *git_odb, backend: *git_odb_backend, priority: c_int) callconv(.C) c_int;
pub const git_odb_num_backends = fn (odb: *git_odb) callconv(.C) usize;
pub const git_odb_get_backend = fn (out: [*c]*git_odb_backend, odb: *git_odb, pos: usize) callconv(.C) c_int;
pub const git_odb_set_commit_graph = fn (odb: *git_odb, cgraph: *git_commit_graph) callconv(.C) c_int;
pub const git_odb_backend_pack = fn (out: [*c]*git_odb_backend, objects_dir: [*c]const u8) callconv(.C) c_int;
pub const git_odb_backend_loose = fn (out: [*c]*git_odb_backend, objects_dir: [*c]const u8, compression_level: c_int, do_fsync: c_int, dir_mode: c_uint, file_mode: c_uint) callconv(.C) c_int;
pub const git_odb_backend_one_pack = fn (out: [*c]*git_odb_backend, index_file: [*c]const u8) callconv(.C) c_int;
pub const git_patch_owner = fn (patch: *const git_patch) callconv(.C) *git_repository;
pub const git_patch_from_diff = fn (out: [*c]*git_patch, diff: *git_diff, idx: usize) callconv(.C) c_int;
pub const git_patch_from_blobs = fn (out: [*c]*git_patch, old_blob: *const git_blob, old_as_path: [*c]const u8, new_blob: *const git_blob, new_as_path: [*c]const u8, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_patch_from_blob_and_buffer = fn (out: [*c]*git_patch, old_blob: *const git_blob, old_as_path: [*c]const u8, buffer: *const c_void, buffer_len: usize, buffer_as_path: [*c]const u8, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_patch_from_buffers = fn (out: [*c]*git_patch, old_buffer: *const c_void, old_len: usize, old_as_path: [*c]const u8, new_buffer: *const c_void, new_len: usize, new_as_path: [*c]const u8, opts: [*c]const git_diff_options) callconv(.C) c_int;
pub const git_patch_free = fn (patch: *git_patch) callconv(.C) void;
pub const git_patch_get_delta = fn (patch: *const git_patch) callconv(.C) [*c]const git_diff_delta;
pub const git_patch_num_hunks = fn (patch: *const git_patch) callconv(.C) usize;
pub const git_patch_line_stats = fn (total_context: [*c]usize, total_additions: [*c]usize, total_deletions: [*c]usize, patch: *const git_patch) callconv(.C) c_int;
pub const git_patch_get_hunk = fn (out: [*c][*c]const git_diff_hunk, lines_in_hunk: [*c]usize, patch: *git_patch, hunk_idx: usize) callconv(.C) c_int;
pub const git_patch_num_lines_in_hunk = fn (patch: *const git_patch, hunk_idx: usize) callconv(.C) c_int;
pub const git_patch_get_line_in_hunk = fn (out: [*c][*c]const git_diff_line, patch: *git_patch, hunk_idx: usize, line_of_hunk: usize) callconv(.C) c_int;
pub const git_patch_size = fn (patch: *git_patch, include_context: c_int, include_hunk_headers: c_int, include_file_headers: c_int) callconv(.C) usize;
pub const git_patch_print = fn (patch: *git_patch, print_cb: git_diff_line_cb, payload: *c_void) callconv(.C) c_int;
pub const git_patch_to_buf = fn (out: [*c]git_buf, patch: *git_patch) callconv(.C) c_int;
pub const git_pathspec_new = fn (out: [*c]*git_pathspec, pathspec: [*c]const git_strarray) callconv(.C) c_int;
pub const git_pathspec_free = fn (ps: *git_pathspec) callconv(.C) void;
pub const git_pathspec_matches_path = fn (ps: *const git_pathspec, flags: u32, path: [*c]const u8) callconv(.C) c_int;
pub const git_pathspec_match_workdir = fn (out: [*c]*git_pathspec_match_list, repo: *git_repository, flags: u32, ps: *git_pathspec) callconv(.C) c_int;
pub const git_pathspec_match_index = fn (out: [*c]*git_pathspec_match_list, index: *git_index, flags: u32, ps: *git_pathspec) callconv(.C) c_int;
pub const git_pathspec_match_tree = fn (out: [*c]*git_pathspec_match_list, tree: *git_tree, flags: u32, ps: *git_pathspec) callconv(.C) c_int;
pub const git_pathspec_match_diff = fn (out: [*c]*git_pathspec_match_list, diff: *git_diff, flags: u32, ps: *git_pathspec) callconv(.C) c_int;
pub const git_pathspec_match_list_free = fn (m: *git_pathspec_match_list) callconv(.C) void;
pub const git_pathspec_match_list_entrycount = fn (m: *const git_pathspec_match_list) callconv(.C) usize;
pub const git_pathspec_match_list_entry = fn (m: *const git_pathspec_match_list, pos: usize) callconv(.C) [*c]const u8;
pub const git_pathspec_match_list_diff_entry = fn (m: *const git_pathspec_match_list, pos: usize) callconv(.C) [*c]const git_diff_delta;
pub const git_pathspec_match_list_failed_entrycount = fn (m: *const git_pathspec_match_list) callconv(.C) usize;
pub const git_pathspec_match_list_failed_entry = fn (m: *const git_pathspec_match_list, pos: usize) callconv(.C) [*c]const u8;
pub const git_refdb_new = fn (out: [*c]*git_refdb, repo: *git_repository) callconv(.C) c_int;
pub const git_refdb_open = fn (out: [*c]*git_refdb, repo: *git_repository) callconv(.C) c_int;
pub const git_refdb_compress = fn (refdb: *git_refdb) callconv(.C) c_int;
pub const git_refdb_free = fn (refdb: *git_refdb) callconv(.C) void;
pub const git_reflog_read = fn (out: [*c]*git_reflog, repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_reflog_write = fn (reflog: *git_reflog) callconv(.C) c_int;
pub const git_reflog_append = fn (reflog: *git_reflog, id: [*c]const git_oid, committer: [*c]const git_signature, msg: [*c]const u8) callconv(.C) c_int;
pub const git_reflog_rename = fn (repo: *git_repository, old_name: [*c]const u8, name: [*c]const u8) callconv(.C) c_int;
pub const git_reflog_delete = fn (repo: *git_repository, name: [*c]const u8) callconv(.C) c_int;
pub const git_reflog_entrycount = fn (reflog: *git_reflog) callconv(.C) usize;
pub const git_reflog_entry_byindex = fn (reflog: *const git_reflog, idx: usize) callconv(.C) *const git_reflog_entry;
pub const git_reflog_drop = fn (reflog: *git_reflog, idx: usize, rewrite_previous_entry: c_int) callconv(.C) c_int;
pub const git_reflog_entry_id_old = fn (entry: *const git_reflog_entry) callconv(.C) [*c]const git_oid;
pub const git_reflog_entry_id_new = fn (entry: *const git_reflog_entry) callconv(.C) [*c]const git_oid;
pub const git_reflog_entry_committer = fn (entry: *const git_reflog_entry) callconv(.C) [*c]const git_signature;
pub const git_reflog_entry_message = fn (entry: *const git_reflog_entry) callconv(.C) [*c]const u8;
pub const git_reflog_free = fn (reflog: *git_reflog) callconv(.C) void;
pub const git_reset = fn (repo: *git_repository, target: *const git_object, reset_type: git_reset_t, checkout_opts: [*c]const git_checkout_options) callconv(.C) c_int;
pub const git_reset_from_annotated = fn (repo: *git_repository, commit: *const git_annotated_commit, reset_type: git_reset_t, checkout_opts: [*c]const git_checkout_options) callconv(.C) c_int;
pub const git_reset_default = fn (repo: *git_repository, target: *const git_object, pathspecs: [*c]const git_strarray) callconv(.C) c_int;
pub const git_revwalk_new = fn (out: [*c]*git_revwalk, repo: *git_repository) callconv(.C) c_int;
pub const git_revwalk_reset = fn (walker: *git_revwalk) callconv(.C) c_int;
pub const git_revwalk_push = fn (walk: *git_revwalk, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_revwalk_push_glob = fn (walk: *git_revwalk, glob: [*c]const u8) callconv(.C) c_int;
pub const git_revwalk_push_head = fn (walk: *git_revwalk) callconv(.C) c_int;
pub const git_revwalk_hide = fn (walk: *git_revwalk, commit_id: [*c]const git_oid) callconv(.C) c_int;
pub const git_revwalk_hide_glob = fn (walk: *git_revwalk, glob: [*c]const u8) callconv(.C) c_int;
pub const git_revwalk_hide_head = fn (walk: *git_revwalk) callconv(.C) c_int;
pub const git_revwalk_push_ref = fn (walk: *git_revwalk, refname: [*c]const u8) callconv(.C) c_int;
pub const git_revwalk_hide_ref = fn (walk: *git_revwalk, refname: [*c]const u8) callconv(.C) c_int;
pub const git_revwalk_next = fn (out: [*c]git_oid, walk: *git_revwalk) callconv(.C) c_int;
pub const git_revwalk_sorting = fn (walk: *git_revwalk, sort_mode: c_uint) callconv(.C) c_int;
pub const git_revwalk_push_range = fn (walk: *git_revwalk, range: [*c]const u8) callconv(.C) c_int;
pub const git_revwalk_simplify_first_parent = fn (walk: *git_revwalk) callconv(.C) c_int;
pub const git_revwalk_free = fn (walk: *git_revwalk) callconv(.C) void;
pub const git_revwalk_repository = fn (walk: *git_revwalk) callconv(.C) *git_repository;
pub const git_revwalk_add_hide_cb = fn (walk: *git_revwalk, hide_cb: git_revwalk_hide_cb, payload: *c_void) callconv(.C) c_int;
pub const git_signature_new = fn (out: [*c]?*git_signature, name: [*c]const u8, email: [*c]const u8, time: git_time_t, offset: c_int) callconv(.C) c_int;
pub const git_signature_now = fn (out: [*c]?*git_signature, name: [*c]const u8, email: [*c]const u8) callconv(.C) c_int;
pub const git_signature_default = fn (out: *?*git_signature, repo: *git_repository) callconv(.C) c_int;
pub const git_signature_from_buffer = fn (out: [*c]?*git_signature, buf: [*c]const u8) callconv(.C) c_int;
pub const git_signature_dup = fn (dest: [*c]?*git_signature, sig: [*c]const git_signature) callconv(.C) c_int;
pub const git_signature_free = fn (sig: [*c]git_signature) callconv(.C) void;
pub const git_tag_lookup = fn (out: [*c]*git_tag, repo: *git_repository, id: [*c]const git_oid) callconv(.C) c_int;
pub const git_tag_lookup_prefix = fn (out: [*c]*git_tag, repo: *git_repository, id: [*c]const git_oid, len: usize) callconv(.C) c_int;
pub const git_tag_free = fn (tag: *git_tag) callconv(.C) void;
pub const git_tag_id = fn (tag: *const git_tag) callconv(.C) [*c]const git_oid;
pub const git_tag_owner = fn (tag: *const git_tag) callconv(.C) *git_repository;
pub const git_tag_target = fn (target_out: [*c]*git_object, tag: *const git_tag) callconv(.C) c_int;
pub const git_tag_target_id = fn (tag: *const git_tag) callconv(.C) [*c]const git_oid;
pub const git_tag_target_type = fn (tag: *const git_tag) callconv(.C) git_object_t;
pub const git_tag_name = fn (tag: *const git_tag) callconv(.C) [*c]const u8;
pub const git_tag_tagger = fn (tag: *const git_tag) callconv(.C) [*c]const git_signature;
pub const git_tag_message = fn (tag: *const git_tag) callconv(.C) [*c]const u8;
pub const git_tag_create = fn (oid: [*c]git_oid, repo: *git_repository, tag_name: [*c]const u8, target: *const git_object, tagger: [*c]const git_signature, message: [*c]const u8, force: c_int) callconv(.C) c_int;
pub const git_tag_annotation_create = fn (oid: [*c]git_oid, repo: *git_repository, tag_name: [*c]const u8, target: *const git_object, tagger: [*c]const git_signature, message: [*c]const u8) callconv(.C) c_int;
pub const git_tag_create_from_buffer = fn (oid: [*c]git_oid, repo: *git_repository, buffer: [*c]const u8, force: c_int) callconv(.C) c_int;
pub const git_tag_create_lightweight = fn (oid: [*c]git_oid, repo: *git_repository, tag_name: [*c]const u8, target: *const git_object, force: c_int) callconv(.C) c_int;
pub const git_tag_delete = fn (repo: *git_repository, tag_name: [*c]const u8) callconv(.C) c_int;
pub const git_tag_list = fn (tag_names: [*c]git_strarray, repo: *git_repository) callconv(.C) c_int;
pub const git_tag_list_match = fn (tag_names: [*c]git_strarray, pattern: [*c]const u8, repo: *git_repository) callconv(.C) c_int;
pub const git_tag_foreach = fn (repo: *git_repository, callback: git_tag_foreach_cb, payload: *c_void) callconv(.C) c_int;
pub const git_tag_peel = fn (tag_target_out: [*c]*git_object, tag: *const git_tag) callconv(.C) c_int;
pub const git_tag_dup = fn (out: [*c]*git_tag, source: *git_tag) callconv(.C) c_int;
pub const git_tag_name_is_valid = fn (valid: [*c]c_int, name: [*c]const u8) callconv(.C) c_int;
pub const git_transaction_new = fn (out: [*c]*git_transaction, repo: *git_repository) callconv(.C) c_int;
pub const git_transaction_lock_ref = fn (tx: *git_transaction, refname: [*c]const u8) callconv(.C) c_int;
pub const git_transaction_set_target = fn (tx: *git_transaction, refname: [*c]const u8, target: [*c]const git_oid, sig: [*c]const git_signature, msg: [*c]const u8) callconv(.C) c_int;
pub const git_transaction_set_symbolic_target = fn (tx: *git_transaction, refname: [*c]const u8, target: [*c]const u8, sig: [*c]const git_signature, msg: [*c]const u8) callconv(.C) c_int;
pub const git_transaction_set_reflog = fn (tx: *git_transaction, refname: [*c]const u8, reflog: *const git_reflog) callconv(.C) c_int;
pub const git_transaction_remove = fn (tx: *git_transaction, refname: [*c]const u8) callconv(.C) c_int;
pub const git_transaction_commit = fn (tx: *git_transaction) callconv(.C) c_int;
pub const git_transaction_free = fn (tx: *git_transaction) callconv(.C) void;
