export function ERR_INVALID_ARG_TYPE(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value?.toString()}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

export function ERR_OUT_OF_RANGE(name, range, value) {
  const err = new RangeError(`The "${name}" argument is out of range. It must be ${range}. Received ${value}`);
  err.code = "ERR_OUT_OF_RANGE";
  return err;
}
