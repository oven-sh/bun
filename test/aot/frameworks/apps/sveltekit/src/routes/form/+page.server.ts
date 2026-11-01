import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ cookies }) => ({ remembered: cookies.get("remembered") ?? "nothing" });

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const word = String((await request.formData()).get("word") ?? "");
    if (!word) return fail(400, { missing: true });
    cookies.set("remembered", word.toUpperCase(), { path: "/" });
    return { saved: word.length };
  },
};
