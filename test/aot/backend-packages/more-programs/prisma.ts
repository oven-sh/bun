import { PrismaPg } from "@prisma/adapter-pg";
import { fakePostgres } from "./fake_pg.ts";
import { PrismaClient } from "./generated/client.ts";
import { listen } from "./lib_http.ts";

const seen: string[] = [];
const server = fakePostgres(seen);
const port = await listen(server);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://u:p@127.0.0.1:${port}/d` }) });

const all = await prisma.person.findMany({ where: { id: { gt: 0 } }, orderBy: { id: "asc" } });
console.log(JSON.stringify(all), all.map(person => person.id + 1).join());
const names = await prisma.person.findMany({ select: { name: true }, where: { name: { in: ["ada", "grace"] } } });
console.log(JSON.stringify(names));
const raw = await prisma.$queryRaw<{ id: number; name: string }[]>`SELECT id, name FROM person WHERE id > ${0}`;
console.log(JSON.stringify(raw));
const [first, second] = await prisma.$transaction([prisma.person.findMany({ take: 5 }), prisma.person.findMany({ skip: 0 })]);
console.log(first.length, second.length);
try { await prisma.person.findFirst({ where: { name: "ada" } }); } catch (error) { console.log("more rows than one:", (error as Error).message.trim().split("\n").pop()); }
try { await prisma.person.findMany({ where: { id: "x" as unknown as number } }); } catch (error) { console.log((error as Error).name); }
await prisma.$disconnect();
server.close();
console.log(seen.map(query => query.replace(/\s+/g, " ")).join(" | "));
console.log("DONE");
