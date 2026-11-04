import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ request, locals }) => {
  await new Promise(resolve => setTimeout(resolve, 5));
  return { askedBy: request.headers.get("x-asked-by") ?? "nobody", seen: locals.seen, people: [{ id: 1, name: "ada" }, { id: 2, name: "grace" }] };
};
