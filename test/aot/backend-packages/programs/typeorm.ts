import "reflect-metadata";
import { Column, DataSource, Entity, MoreThan, PrimaryGeneratedColumn } from "typeorm";
import { timed } from "./lib_http.ts";

@Entity()
class Person {
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
  @Column({ default: 0 }) age!: number;
}

const source = new DataSource({ type: "sqljs", entities: [Person], synchronize: true, logging: false });
await timed("initialize", () => source.initialize());
const people = source.getRepository(Person);
await people.save([{ name: "ada", age: 36 }, { name: "grace", age: 85 }]);
console.log(JSON.stringify(await people.find({ where: { age: MoreThan(40) } })), await people.count());
console.log(people.createQueryBuilder("p").where("p.age > :age", { age: 1 }).orderBy("p.name").getSql());
console.log(Reflect.getMetadata("design:type", Person.prototype, "name") === String);
await timed("300 saves", async () => { for (let i = 0; i < 300; i++) await people.save({ name: "n" + i, age: i }); });
console.log(await people.count(), JSON.stringify(await people.createQueryBuilder("p").select("sum(p.age)", "sum").getRawOne()));
await source.destroy();
console.log("DONE");
