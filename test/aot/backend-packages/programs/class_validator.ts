import "reflect-metadata";
import { Expose, instanceToPlain, plainToInstance, Transform, Type } from "class-transformer";
import { IsEmail, IsInt, IsOptional, Length, Max, Min, validateSync, ValidateNested } from "class-validator";

class Address { @Length(2, 20) city!: string; }
class Person {
  @Length(1, 10) name!: string;
  @IsInt() @Min(0) @Max(150) age!: number;
  @IsEmail() @IsOptional() email?: string;
  @ValidateNested() @Type(() => Address) address!: Address;
  @Expose({ name: "shout" }) @Transform(({ obj }: { obj: Person }) => obj.name.toUpperCase()) loud!: string;
}
const good = plainToInstance(Person, { name: "ada", age: 36, address: { city: "london" } });
console.log(good instanceof Person, good.address instanceof Address, validateSync(good).length, JSON.stringify(instanceToPlain(good)));
const bad = plainToInstance(Person, { name: "", age: 200.5, email: "nope", address: { city: "x" } });
console.log(JSON.stringify(validateSync(bad).map(error => [error.property, Object.keys(error.constraints ?? {}).sort(), error.children?.map(child => child.property)])));
console.log("DONE");
