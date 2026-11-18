use bun_engine_asm::Features;
use bun_engine_exec_memory::{CodeHandle, Priority, link};
use bun_engine_regexp::tree::Tree;
use bun_engine_regexp::{Error, Flags, Mode, Outcome, Pattern, Program, Rivals, Width};
use bun_engine_regexp_jit::{Compiler, Options, Tables, outcome};
use bun_engine_standalone as _;
use bun_engine_text::Text;

pub(crate) fn program(source: &str, letters: &str, subject: Text<'_>, mode: Mode) -> Program {
    compile_with(bun_engine_regexp::compile, source, letters, subject, mode)
}

pub(crate) fn rivals(source: &str, subject: Text<'_>) -> Rivals {
    let with_compiler = |tree: &Tree, options: &bun_engine_regexp::Options<'_>| {
        Rivals::new(&mut bun_engine_regexp::Compiler::default(), tree, options)
    };
    compile_with(with_compiler, source, "", subject, Mode::Captures)
}

fn compile_with<T>(
    compile: impl FnOnce(&Tree, &bun_engine_regexp::Options<'_>) -> Result<T, Error>,
    source: &str,
    letters: &str,
    subject: Text<'_>,
    mode: Mode,
) -> T {
    let units: Vec<u16> = source.encode_utf16().collect();
    let flags = Flags::parse(Text::from_ascii(letters)).unwrap();
    let pattern = Pattern::new(Text::Utf16(&units), flags).unwrap();
    let options = bun_engine_regexp::Options {
        width: if subject.is_latin1() {
            Width::Latin1
        } else {
            Width::Utf16
        },
        mode,
        sample: subject,
        stack_limit: 0,
    };
    compile(pattern.tree(), &options).unwrap()
}

/// In each width that holds it.
pub(crate) fn in_each_width(text: &str, mut check: impl FnMut(Text<'_>)) {
    let units: Vec<u16> = text.encode_utf16().collect();
    let narrow: Option<Vec<u8>> = units.iter().map(|&unit| unit.try_into().ok()).collect();
    if let Some(narrow) = &narrow {
        check(Text::Latin1(narrow));
    }
    check(Text::Utf16(&units));
}

#[repr(C)]
struct Results(usize, usize);

#[cfg(target_arch = "x86_64")]
type Entry<C> = extern "sysv64" fn(*const u8, usize, usize, *mut u32, &mut C) -> Results;
#[cfg(not(target_arch = "x86_64"))]
type Entry<C> = extern "C" fn(*const u8, usize, usize, *mut u32, &mut C) -> Results;

pub(crate) struct Native<'a> {
    program: &'a Program,
    code: CodeHandle,
    _tables: Tables,
}

/// For the least processor and for this one.
pub(crate) fn natives(program: &Program) -> [Native<'_>; 2] {
    [Features::empty(), Features::host()].map(|features| {
        let options = Options {
            features,
            seed: 1,
            max_code_size: 16 << 20,
            max_units: None,
        };
        let mut compiler = Compiler::default();
        let (code, tables) = (compiler.compile(program.verify().unwrap(), &options)).unwrap();
        Native {
            program,
            code: link(code, Priority::Required, |_| unreachable!()).unwrap(),
            _tables: tables,
        }
    })
}

impl Native<'_> {
    /// `C` is `Racing` if the program counts turns, and `Context` otherwise.
    pub(crate) fn exec<C>(
        &self,
        subject: Text<'_>,
        start: u32,
        captures: &mut [u32],
        context: &mut C,
    ) -> Outcome {
        let (units, width) = match subject {
            Text::Latin1(characters) => (characters.as_ptr(), Width::Latin1),
            Text::Utf16(units) => (units.as_ptr().cast(), Width::Utf16),
        };
        assert_eq!(width, self.program.width());
        assert!(
            !self.program.reports_captures() || captures.len() == self.program.capture_entries()
        );
        // SAFETY: the code has this type, and the arguments are what its program was compiled for.
        let entry = unsafe { std::mem::transmute::<usize, Entry<C>>(self.code.start()) };
        let Results(start, end) = entry(
            units,
            start as usize,
            subject.len(),
            captures.as_mut_ptr(),
            context,
        );
        outcome(start, end)
    }
}
