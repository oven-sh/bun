class AppError extends Error {
  static CODE = "E_APP";
  constructor(message, status = 500) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}
const NOT_FOUND = 404;
try {
  throw new AppError("missing", NOT_FOUND);
} catch (e) {
  console.log(e.name, e.message, e.status, e instanceof AppError, e instanceof Error, AppError.CODE, String(e));
}
