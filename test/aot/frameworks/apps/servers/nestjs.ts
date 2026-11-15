import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Injectable()
class CatsService {
  private readonly cats: string[] = ["Tom"];
  findAll(): string[] {
    return this.cats;
  }
  create(name: string): number {
    return this.cats.push(name);
  }
}
@Controller("cats")
class CatsController {
  constructor(private readonly catsService: CatsService) {}
  @Get() findAll(): string[] {
    return this.catsService.findAll();
  }
  @Get("forbidden") forbidden(): never {
    throw new HttpException("Forbidden", HttpStatus.FORBIDDEN);
  }
  @Get(":id") findOne(@Param("id", ParseIntPipe) id: number) {
    return { id, type: typeof id };
  }
  @Post() create(@Body() body: { name: string }) {
    return { count: this.catsService.create(body.name) };
  }
}
@Module({ controllers: [CatsController], providers: [CatsService] })
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: false });
await app.listen(0, "127.0.0.1");
const url = await app.getUrl();
const show = async (path: string, init?: RequestInit) => {
  const response = await fetch(url + path, init);
  console.log(path, response.status, await response.text());
};
await show("/cats");
await show("/cats", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Felix" }),
});
await show("/cats/7");
await show("/cats/seven");
await show("/cats/forbidden");
await show("/dogs");
console.log(app.get(CatsService).findAll().join(), Reflect.getMetadata("design:paramtypes", CatsController)[0].name);
await app.close();
