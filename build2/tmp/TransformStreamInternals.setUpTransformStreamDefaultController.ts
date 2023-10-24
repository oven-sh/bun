// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,controller,transformAlgorithm,flushAlgorithm) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isTransformStream(stream),"$isTransformStream(stream)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "controller") === undefined,"$getByIdDirectPrivate(stream, \"controller\") === undefined"):void 0);

  __intrinsic__putByIdDirectPrivate(controller, "stream", stream);
  __intrinsic__putByIdDirectPrivate(stream, "controller", controller);
  __intrinsic__putByIdDirectPrivate(controller, "transformAlgorithm", transformAlgorithm);
  __intrinsic__putByIdDirectPrivate(controller, "flushAlgorithm", flushAlgorithm);
}).$$capture_end$$;
