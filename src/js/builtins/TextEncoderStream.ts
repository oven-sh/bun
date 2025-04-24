export function initializeTextEncoderStream() {
  const startAlgorithm = () => {
    return Promise.$resolve();
  };
  const transformAlgorithm = chunk => {
    const encoder = $getByIdDirectPrivate(this, "textEncoderStreamEncoder");
    try {
      var buffer = encoder.encode(chunk);
    } catch (e) {
      return Promise.$reject(e);
    }
    if (buffer.length) {
      const transformStream = $getByIdDirectPrivate(this, "textEncoderStreamTransform");
      const controller = $getByIdDirectPrivate(transformStream, "controller");
      $transformStreamDefaultControllerEnqueue(controller, buffer);
    }
    return Promise.$resolve();
  };
  const flushAlgorithm = () => {
    const encoder = $getByIdDirectPrivate(this, "textEncoderStreamEncoder");
    const buffer = encoder.flush();
    if (buffer.length) {
      const transformStream = $getByIdDirectPrivate(this, "textEncoderStreamTransform");
      const controller = $getByIdDirectPrivate(transformStream, "controller");
      $transformStreamDefaultControllerEnqueue(controller, buffer);
    }
    return Promise.$resolve();
  };

  const transform = $createTransformStream({ start: startAlgorithm, transform: transformAlgorithm, flush: flushAlgorithm }, undefined, undefined, undefined, undefined, undefined, undefined);
  $putByIdDirectPrivate(this, "textEncoderStreamTransform", transform);
  $putByIdDirectPrivate(this, "textEncoderStreamEncoder", new TextEncoderStreamEncoder());

  return this;
}

$getter;
export function encoding() {
  if (!$getByIdDirectPrivate(this, "textEncoderStreamTransform")) throw $ERR_INVALID_THIS("TextEncoderStream");

  return "utf-8";
}

$getter;
export function readable() {
  const transform = $getByIdDirectPrivate(this, "textEncoderStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("TextEncoderStream");

  return $getByIdDirectPrivate(transform, "readable");
}

$getter;
export function writable() {
  const transform = $getByIdDirectPrivate(this, "textEncoderStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("TextEncoderStream");

  return $getByIdDirectPrivate(transform, "writable");
}