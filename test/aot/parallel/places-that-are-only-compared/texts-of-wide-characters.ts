function route(path: string): string {
  const parts = path.split("/");
  return [parts[1] === "users", parts[1] === "用户", parts[2] === "é", parts[2] === "7", parts[3] === "x"].join(",");
}
console.log(["/users/7", "/用户/7", "/用户/é", "/users/é/x", "/用/7", "/用户们/7", "/users/７"].map(route).join(" | "));
