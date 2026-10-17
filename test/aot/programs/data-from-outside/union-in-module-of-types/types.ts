export type Either<In, Result> = { early: In; late?: undefined } | { late: Result; early?: undefined };
export type Act<In> = { early: Promise<In>; isEarly(): boolean };
