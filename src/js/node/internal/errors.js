function ERR_OUT_OF_RANGE(str, range, input, replaceDefaultBoolean = false) {
  // Node implementation:
  // assert(range, 'Missing "range" argument');
  // let msg = replaceDefaultBoolean
  //   ? str
  //   : `The value of "${str}" is out of range.`;
  // let received;
  // if (NumberIsInteger(input) && MathAbs(input) > 2 ** 32) {
  //   received = addNumericalSeparator(String(input));
  // } else if (typeof input === "bigint") {
  //   received = String(input);
  //   if (input > 2n ** 32n || input < -(2n ** 32n)) {
  //     received = addNumericalSeparator(received);
  //   }
  //   received += "n";
  // } else {
  //   received = lazyInternalUtilInspect().inspect(input);
  // }
  // msg += ` It must be ${range}. Received ${received}`;
  // return new RangeError(msg);
  return new RangeError(`The value of ${str} is out of range. It must be ${range}. Received ${input}`);
}

function ERR_CHILD_PROCESS_STDIO_MAXBUFFER(stdio) {
  return Error(`${stdio} maxBuffer length exceeded`);
}

function ERR_UNKNOWN_SIGNAL(name) {
  const err = new TypeError(`Unknown signal: ${name}`);
  err.code = "ERR_UNKNOWN_SIGNAL";
  return err;
}

function ERR_INVALID_ARG_TYPE(name, type, value) {
  const err = new TypeError(`The "${name}" argument must be of type ${type}. Received ${value?.toString()}`);
  err.code = "ERR_INVALID_ARG_TYPE";
  return err;
}

function ERR_INVALID_OPT_VALUE(name, value) {
  return new TypeError(`The value "${value}" is invalid for option "${name}"`);
}

function ERR_INVALID_ARG_VALUE(name, value, reason) {
  return new Error(`The value "${value}" is invalid for argument '${name}'. Reason: ${reason}`);
}

function ERR_CHILD_PROCESS_IPC_REQUIRED(name) {
  const err = new TypeError(`Forked processes must have an IPC channel, missing value 'ipc' in ${name}`);
  err.code = "ERR_CHILD_PROCESS_IPC_REQUIRED";
  return err;
}

function ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(name, type) {
  const err = new Error(`The selected key encoding ${name} ${type}.`);
  err.code = "ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS";
  return err;
}

function ERR_INCOMPATIBLE_OPTION_PAIR(base, option) {
  const err = new TypeError(`Option "${base}" cannot be used in combination with option "${option}"`);
  err.code = "ERR_INCOMPATIBLE_OPTION_PAIR";
  return err;
}

function ERR_MISSING_OPTION(name) {
  const err = new TypeError(`${name} is required`);
  err.code = "ERR_MISSING_OPTION";
  return err;
}

export default {
  ERR_OUT_OF_RANGE,
  ERR_CHILD_PROCESS_STDIO_MAXBUFFER,
  ERR_UNKNOWN_SIGNAL,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_OPT_VALUE,
  ERR_INVALID_ARG_VALUE,
  ERR_CHILD_PROCESS_IPC_REQUIRED,
  ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS,
  ERR_INCOMPATIBLE_OPTION_PAIR,
  ERR_MISSING_OPTION,
};
