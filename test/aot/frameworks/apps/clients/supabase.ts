import { createClient } from "@supabase/supabase-js";

interface Database {
  public: {
    Tables: {
      todos: {
        Row: { id: number; title: string };
        Insert: { title: string };
        Update: { title?: string };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
  };
}
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/todos")
      return Response.json([{ id: 1, title: "write " + url.searchParams.get("select") }]);
    return Response.json({ message: "no such table", code: "42P01", details: null, hint: null }, { status: 404 });
  },
});
const supabase = createClient<Database>(`http://localhost:${server.port}`, "public-anon-key", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error, status } = await supabase.from("todos").select("id,title").eq("id", 1);
console.log(status, error, data?.[0].id, data?.[0].title);
const missing = await (supabase as ReturnType<typeof createClient>).from("nothing").select();
console.log(missing.status, missing.error?.code, missing.data);
server.stop(true);
