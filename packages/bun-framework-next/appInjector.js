export function maybeInjectApp(expr) {
  var app;
  try {
    const path = Bun.routesDir + "/_app";
    app = Bun.resolveSync(path, Bun.cwd + "/");
  } catch (exception) {
    return undefined;
  }

  return (
    <>
      <import path={app} />
    </>
  );
}
