// internal/core/stack.go

#[derive(Clone, Debug)]
pub struct Stack<T> {
    data: Vec<T>,
}

impl<T> Default for Stack<T> {
    fn default() -> Self {
        Stack { data: Vec::new() }
    }
}

impl<T> Stack<T> {
    pub fn push(&mut self, item: T) {
        self.data.push(item);
    }

    // Err is upstream's panic with its message.
    pub fn pop(&mut self) -> Result<T, &'static str> {
        self.data.pop().ok_or("stack is empty")
    }

    // Err is upstream's panic with its message.
    pub fn peek(&self) -> Result<T, &'static str>
    where
        T: Clone,
    {
        self.data.last().cloned().ok_or("stack is empty")
    }

    pub fn len(&self) -> isize {
        self.data.len() as isize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack() {
        let mut s: Stack<u32> = Stack::default();
        assert_eq!(s.pop(), Err("stack is empty"));
        assert_eq!(s.peek(), Err("stack is empty"));
        s.push(1);
        s.push(2);
        assert_eq!((s.len(), s.peek()), (2, Ok(2)));
        assert_eq!((s.pop(), s.pop(), s.len()), (Ok(2), Ok(1), 0));
    }
}
