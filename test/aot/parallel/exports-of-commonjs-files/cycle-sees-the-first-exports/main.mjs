// two files require each other: one sees the first exports object of the other, half filled, which is then replaced
// Under: --aot-testing=CheckProofsAtRunTime: what a read of the exports variable finds is held against what Link says of it
import "./start.cjs";
