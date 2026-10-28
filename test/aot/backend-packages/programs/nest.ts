import "reflect-metadata";
import { Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { IsInt, IsString, Min } from "class-validator";
import type { AddressInfo } from "node:net";
import { timed } from "./lib_http.ts";

class CreatePerson {
  @IsString() name!: string;
  @IsInt() @Min(0) age!: number;
}

@Injectable()
class People {
  private readonly all = new Map<number, CreatePerson>([[1, { name: "ada", age: 36 }]]);
  find(id: number): CreatePerson | undefined { return this.all.get(id); }
  add(person: CreatePerson): number { const id = this.all.size + 1; this.all.set(id, person); return id; }
}

@Controller("people")
class PeopleController {
  constructor(private readonly people: People) {}
  @Get(":id") one(@Param("id", ParseIntPipe) id: number) { return this.people.find(id) ?? { missing: id }; }
  @Post() add(@Body() person: CreatePerson) { return { id: this.people.add(person), isInstance: person instanceof CreatePerson }; }
}

@Module({ controllers: [PeopleController], providers: [People] })
class AppModule {}

const app = await timed("create", () => NestFactory.create(AppModule, { logger: false }));
app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
await app.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
const post = (body: unknown) => fetch(base + "/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
console.log(await (await fetch(base + "/people/1")).text());
console.log((await fetch(base + "/people/x")).status);
console.log(await (await post({ name: "grace", age: 85, extra: true })).text());
const refused = await post({ name: 5, age: -1 });
console.log(refused.status, await refused.text());
await app.close();
console.log("DONE");
