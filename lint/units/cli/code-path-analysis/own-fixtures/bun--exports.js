/*languageOptions
    {"sourceType":"module"}
*/
/*expected
initial->s2_1->s2_2;
s2_1->final;
*/
/*expected
initial->s3_1->final;
*/
/*expected
initial->s1_1->s1_2->s1_3->s1_4->s1_6;
s1_1->s1_3->s1_5->s1_6->final;
*/
export var a = b || c;
export default d ? e : f;
export function g() { return h; }
export class I { j() {} }
export { a as k };
export * from 'l';
import m, { n as o } from 'p';
