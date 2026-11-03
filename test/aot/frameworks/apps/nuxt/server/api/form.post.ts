export default defineEventHandler(async event => {
  const parts = (await readMultipartFormData(event)) ?? [];
  return parts.map(part => ({ name: part.name, filename: part.filename ?? null, type: part.type ?? null, text: part.data.toString("utf8") })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
});
