import { cookies } from "next/headers";

async function remember(form: FormData) {
  "use server";
  (await cookies()).set("remembered", String(form.get("word")).toUpperCase(), { path: "/" });
}

export default async function Page() {
  return (
    <form action={remember}>
      <p>remembered: {(await cookies()).get("remembered")?.value ?? "nothing"}</p>
      <input name="word" defaultValue="hello" />
      <button type="submit">remember</button>
    </form>
  );
}
