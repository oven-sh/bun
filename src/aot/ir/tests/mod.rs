mod body;
mod builder;
mod edge_results;
mod entry_parameters;
mod graphs;
mod handlers;
mod property_keys;
mod random_graphs;
mod references;
mod sections;
mod strings;
mod text;
mod types;

use super::generated::{Function, FunctionRelations};
use super::ids::{FunctionId, Id};
use super::print::print_function;
use super::program::Program;

pub(super) struct Generator(u64);

impl Generator {
    pub(super) fn new(seed: u64) -> Generator {
        Generator(seed | 1)
    }

    pub(super) fn next(&mut self) -> u64 {
        let mut state = self.0;
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        self.0 = state;
        state.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    pub(super) fn below(&mut self, bound: usize) -> usize {
        ((self.next() >> 32) as usize) % bound
    }

    pub(super) fn one_in(&mut self, n: usize) -> bool {
        self.below(n) == 0
    }
}

// Without the relations: who prints a function this way looks at its header and its body, and the relations have tests of their own.
pub(super) fn print_alone(function: &Function) -> String {
    let function = Function {
        relations: FunctionRelations::default(),
        ..function.clone()
    };
    let program = Program::new();
    let mut text = String::new();
    print_function(program.name_tables(), FunctionId::new(0), &function, &mut text);
    text
}

#[test]
fn generator_is_deterministic() {
    let mut generator = Generator::new(1);
    let numbers: [u64; 4] = core::array::from_fn(|_| generator.next());
    assert_eq!(
        numbers,
        [
            0x47E4_CE4B_896C_DD1D,
            0xABCF_A6A8_E079_651D,
            0xB9D1_0D8F_EB73_1F57,
            0x4DB4_18A0_BB1B_019D,
        ]
    );
    let mut same_seed = Generator::new(1);
    let repeated: [u64; 4] = core::array::from_fn(|_| same_seed.next());
    assert_eq!(repeated, numbers);
    assert_ne!(Generator::new(7).next(), numbers[0]);
    assert_eq!(Generator::new(0).next(), numbers[0]);
}
