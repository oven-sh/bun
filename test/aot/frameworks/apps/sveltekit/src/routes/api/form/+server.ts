import { json, type RequestHandler } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const file = form.get("file");
  return json({ names: [...form.keys()].sort(), word: form.get("word"), file: file instanceof File ? [file.name, file.size, await file.text()] : null });
};
