const STATUS = Object.freeze({ OK: 200, CREATED: 201, NOT_FOUND: 404, SERVER_ERROR: 500 });
const TEXT = { [STATUS.OK]: "OK", [STATUS.CREATED]: "Created", [STATUS.NOT_FOUND]: "Not Found", [STATUS.SERVER_ERROR]: "Internal Server Error" };
function describe(code) {
  return `${code} ${TEXT[code] ?? "Unknown"}`;
}
console.log(describe(STATUS.OK), "|", describe(STATUS.NOT_FOUND), "|", describe(418));
console.log(Object.keys(TEXT), Object.values(STATUS).filter((c) => c >= 400));
