import "reflect-metadata";
import { Exclude, Expose, Transform, Type, instanceToPlain, plainToInstance } from "class-transformer";
import { IsEmail, IsInt, IsOptional, Length, Max, Min, ValidateNested, validate, validateSync } from "class-validator";

class Address {
  @Length(2, 20) city!: string;
}
class User {
  @Length(3, 20) name!: string;
  @IsInt() @Min(0) @Max(120) age!: number;
  @IsEmail() email!: string;
  @IsOptional() @ValidateNested() @Type(() => Address) address?: Address;
  @Type(() => Date) born!: Date;
  @Exclude() password!: string;
  @Expose({ name: "loud" }) get shout(): string {
    return this.name.toUpperCase();
  }
  @Transform(({ value }) => String(value).split(",")) tags!: string[];
}
const user = plainToInstance(User, {
  name: "Ada",
  age: 36,
  email: "ada@example.com",
  address: { city: "London" },
  born: "1815-12-10T00:00:00.000Z",
  password: "secret",
  tags: "a,b",
});
console.log(
  user instanceof User,
  user.address instanceof Address,
  user.born instanceof Date,
  user.born.getUTCFullYear(),
  user.tags.length,
  user.shout,
  JSON.stringify(instanceToPlain(user)),
);
console.log((await validate(user)).length);
const errors = validateSync(
  plainToInstance(User, { name: "A", age: 1.5, email: "nope", address: { city: "L" }, tags: "" }),
);
console.log(
  errors
    .map(
      error =>
        `${error.property}: ${
          Object.keys(error.constraints ?? {})
            .sort()
            .join("+") ||
          error.children?.map(child => child.property + ":" + Object.keys(child.constraints ?? {}).join()).join()
        }`,
    )
    .join("; "),
);
