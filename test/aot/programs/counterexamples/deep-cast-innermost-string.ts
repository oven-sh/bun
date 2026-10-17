// A cast to nested optional members, the innermost of which is a string at run time; the next line tests `typeof`.
declare const console: { log(...values: unknown[]): void };
// A deep `as` whose innermost member is a string at run time; the program tests typeof on the next line.
function fields(error: unknown) {
  const body = (error as { response?: { data?: { error?: { type?: unknown; message?: unknown } } } })?.response?.data?.error
  if (!body || typeof body !== 'object') return {}
  return { type: body.type }
}
console.log(JSON.stringify(fields({ response: { data: JSON.parse('{"error":"not found"}') } })), JSON.stringify(fields(JSON.parse('{"response":{"data":{"error":{"type":"t"}}}}'))))
