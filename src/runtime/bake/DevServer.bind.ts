import * as b from "../../codegen/bindgen-lib.ts";

export const getDeinitCountForTesting = b.fn({
  returns: b.usize,
  rustPath: "crate::bake::get_deinit_count_for_testing",
});

const setupReaction = { args: { value: b.any, context: b.any }, capability: "js", throws: true } as const;

/** The reactions to the promise a plugin's `setup()` returned. */
export const onPluginSetupResolve = b.fn({
  ...setupReaction,
  export: "Bun__DevServer__onPluginSetupResolve",
  rustPath: "crate::bake::dev_server::on_plugin_setup_resolve",
});
export const onPluginSetupReject = b.fn({
  ...setupReaction,
  export: "Bun__DevServer__onPluginSetupReject",
  rustPath: "crate::bake::dev_server::on_plugin_setup_reject",
});
