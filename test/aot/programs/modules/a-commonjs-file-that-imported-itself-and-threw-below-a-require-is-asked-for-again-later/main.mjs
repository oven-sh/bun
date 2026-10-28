// A required module calls import() of a CommonJS file, which calls import() of itself and throws. A timer asks for the file again, by require() and by import().
import "./first.cjs";
