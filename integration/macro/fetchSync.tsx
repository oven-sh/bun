export async function fetchSync(ctx) {
  const str = ctx.arguments[0].toString();

  const response = await fetch(str);
  const text = await response.text();

  return <string value={text} />;
}
