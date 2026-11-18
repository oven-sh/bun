use crate::protocol::Reply;
use crate::win32::com::{self, Outcome, filled, made};
use crate::win32::*;

fn checker() -> Outcome<ISpellChecker> {
    _ = CoInitializeEx(0, COINIT_MULTITHREADED);
    let factory: ISpellCheckerFactory = com::create(CLSID_SPELL_CHECKER_FACTORY)?;
    made(|it| factory.create_spell_checker(Wide::new(language_of_user()).str(), it))
}

pub fn check(text: &[u16]) -> Outcome<Reply> {
    let (checker, text) = (
        checker()?,
        Wide::of(text.iter().map(|it| if *it == 0 { 32 } else { *it })),
    );
    let errors = made(|it| checker.check(text.str(), it))?;
    let range = |error: ISpellingError| {
        Ok([
            filled(|it| error.get_start_index(it))?,
            filled(|it| error.get_length(it))?,
        ])
        .map(|[start, length]| [start, start + length])
    };
    Ok(Reply::Misspelled(
        std::iter::from_fn(|| made(|it| errors.next(it)).ok())
            .map(range)
            .collect::<Outcome<Vec<_>>>()?
            .into(),
    ))
}

pub fn guess(word: &str) -> Outcome<Reply> {
    let checker = checker()?;
    let words = made(|it| checker.suggest(Wide::new(word).str(), it))?;
    Ok(Reply::Guesses(
        std::iter::from_fn(|| made(|it| words.next(1, it, &mut 0)).ok())
            .map(|it| it.text().into())
            .collect(),
    ))
}

pub fn learn(word: &str) -> Outcome<Reply> {
    checker()?
        .add(Wide::new(word).str())
        .ok()
        .map(|()| Reply::Done)
}
