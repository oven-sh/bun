// A small Lisp: reader, printer, environments, macros, tail calls, a library written in itself, in two modules
import { Env, print, Machine, library } from "./lib";
const machine = new Machine();
machine.run(library);
const programs = ["(define (fact n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 20)",
  "(define (fib n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2))))) (fib 19)",
  "(define (loop n a) (if (= n 0) a (loop (- n 1) (+ a n)))) (loop 60000 0)",
  "(sort (map (lambda (i) (mod (* i 7919) 1009)) (range 0 150)))",
  "((compose (lambda (x) (+ x 1)) (lambda (x) (* x x))) 6)",
  "(let ((v (make-vector 2000 #t)) (n 0)) (for i 2 2000 (when (ref v i) (set! n (+ n 1)) (let ((k (* i 2))) (while (< k 2000) (put! v k #f) (set! k (+ k i)))))) n)",
  "(define (make-counter) (let ((n 0)) (lambda () (set! n (+ n 1)) n))) (define c (make-counter)) (c) (c) (list (c) (c))",
  "`(1 ,(+ 1 1) ,@(list 3 4) (5 . 6))",
  "(try (lambda () (car 5)) (lambda (m) (text \"caught \" m)))", "(apply + (range 0 100))",
  "(and 1 nil 2)", "(or #f nil 7)", "(cond (#f 1) ((> 2 1) 'yes) (else 'no))",
  "(print \"x\" '(a . (b c)) fact) nil", "(undefined-name)", "(1 2)", "(fact 1 2)", "(", ")",
  "(car nil)", "(ref (vector 1) 5)"];
for (let round = 0; round < 3; round++) for (const p of programs) {
  let text: string;
  try {
    text = print(machine.run(p));
} catch (e) {
    text = (e as Error).name + " " + (e as Error).message;
  }
  if (round === 0) console.log(text.slice(0, 300));
}
console.log(machine.out.join(" | "), machine.steps, Env.lookups);
