// core/core.go 36-50, 80-89, 151-165, 307-315: the slice helpers whose result can be their argument. The callback gets the checker.
use crate::checker::arena::ListItem;
use crate::checker::checker::Checker;
use crate::tscore::golang::{List, SliceBuf};

impl<'a> Checker<'a> {
    // core.Filter: the argument itself when nothing is removed, else a new non-nil list.
    pub fn filter<T: ListItem<'a>>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> bool,
    ) -> List<'a, T> {
        for (i, value) in slice.iter().enumerate() {
            if !f(self, value) {
                let mut result = SliceBuf::make(0, slice.len());
                result.extend(slice.sub(0usize, i));
                for j in i + 1..slice.len() as usize {
                    let value = slice.at(j);
                    if f(self, value) {
                        result.push(value);
                    }
                }
                return self.list(&result);
            }
        }
        slice
    }

    // core.Map: nil for nil, else a new list of the same length.
    pub fn map_list<T: Copy + Default, U: ListItem<'a>>(
        &mut self,
        slice: List<'_, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> U,
    ) -> List<'a, U> {
        if slice.is_nil() {
            return List::NIL;
        }
        let mut result = SliceBuf::make(0, slice.len());
        for value in slice.iter() {
            let mapped = f(self, value);
            result.push(mapped);
        }
        self.list(&result)
    }

    // core.SameMap: the argument itself when no element changes.
    pub fn same_map<T: ListItem<'a> + PartialEq>(
        &mut self,
        slice: List<'a, T>,
        mut f: impl FnMut(&mut Checker<'a>, T) -> T,
    ) -> List<'a, T> {
        for (i, value) in slice.iter().enumerate() {
            let mapped = f(self, value);
            if mapped != value {
                let mut result = SliceBuf::make(0, slice.len());
                result.extend(slice.sub(0usize, i));
                result.push(mapped);
                for j in i + 1..slice.len() as usize {
                    let mapped = f(self, slice.at(j));
                    result.push(mapped);
                }
                return self.list(&result);
            }
        }
        slice
    }

    // core.Concatenate: one of the arguments when the other is empty.
    pub fn concatenate<T: ListItem<'a>>(&self, s1: List<'a, T>, s2: List<'a, T>) -> List<'a, T> {
        if s2.len() == 0 {
            return s1;
        }
        if s1.len() == 0 {
            return s2;
        }
        let mut result = SliceBuf::make(0, s1.len() + s2.len());
        result.extend(s1);
        result.extend(s2);
        self.list(&result)
    }
}
