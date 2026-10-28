export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  return Response.json({ names: [...form.keys()].sort(), word: form.get("word"), file: file instanceof File ? [file.name, file.size, await file.text()] : null });
}
