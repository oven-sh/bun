// This is the implementation for $debug
export function createLogClientJS(filepath: string, publicName: string) {
  return `
let $debug_log_enabled = ((env) => (
  // The rationale for checking all these variables is just so you don't have to exactly remember which one you set.
  (env.BUN_DEBUG_ALL && env.BUN_DEBUG_ALL !== '0')
  || (env.BUN_DEBUG_JS && env.BUN_DEBUG_JS !== '0')
  || (env.BUN_DEBUG_${filepath
    .replace(/^.*?:/, "")
    .split(/[-_./]/g)
    .join("_")
    .toUpperCase()})
  || (env.DEBUG_${filepath
    .replace(/^.*?:/, "")
    .split(/[-_./]/g)
    .join("_")
    .toUpperCase()})
))(Bun.env);
let $debug_log = $debug_log_enabled ? (...args) => {
  // warn goes to stderr without colorizing
  console.warn(Bun.enableANSIColors ? '\\x1b[90m[${publicName}]\\x1b[0m' : '[${publicName}]', ...args);
} : () => {};
`;
}

export function createAssertClientJS(publicName: string) {
  return `
let $assert = function(check, sourceString, ...message) {
  if (!check) {
    const prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, stack) => {
      return e.name + ': ' + e.message + '\\n' + stack.slice(1).map(x => '  at ' + x.toString()).join('\\n');
    };
    const e = new Error(sourceString);
    e.stack; // materialize stack
    e.name = 'AssertionError';
    Error.prepareStackTrace = prevPrepareStackTrace;
    console.error('[${publicName}] ASSERTION FAILED: ' + sourceString);
    if (message.length) console.warn(...message);
    console.warn(e.stack.split('\\n')[1] + '\\n');
    if (Bun.env.ASSERT === 'CRASH') process.exit(0xAA);
    throw e;
  }
}
`;
}
